import express from 'express'
import * as lark from '@larksuiteoapi/node-sdk'
import bodyParser from 'body-parser'
import { Configuration, OpenAIApi } from 'openai'
import nodeCache from 'node-cache'
import dotenv from 'dotenv'
import { encode } from 'gpt-3-encoder'

const cache = new nodeCache()

dotenv.config()
const env = process.env

const app = express()
app.use(bodyParser.json())

const client = new lark.Client({
  appId: env.LARK_APP_ID || '',
  appSecret: env.LARK_APP_SECRET || '',
  domain: env.LARK_DOMAIN
})

const configuration = new Configuration({
  apiKey: env.OPENAI_API_KEY
})
const openai = new OpenAIApi(configuration)

const MAX_TOKEN_LENGTH = 4096
const MAX_GENERATE_TOKEN_LENGTH = 1024
const INIT_COMMAND = 'The following is a conversation with an AI assistant. The assistant is helpful, creative, clever, and very friendly.'

async function reply (messageID: string, content: string) {
  return await client.im.message.reply({
    path: {
      message_id: messageID
    },
    data: {
      content: JSON.stringify({
        'text': content
      }),
      msg_type: 'text'
    }
  })
}

function getTokenLength (content: string) {
  return encode(content).length
}

async function createCompletion (userID: string, question: string) {
  console.info(`[Lark] Receive from ${userID}: ${question}`)

  try {
    const session: [string, string][] = cache.get(`session:${userID}`) || []
    let promptHead = `${INIT_COMMAND}\n\n`
    let prompt = ''
    const reverseSession = session.reverse()
    for (const index in reverseSession) {
      const [q, a] = reverseSession[index]
      const tempPrompt = `Human: ${q}\nAI: ${a}\n` + prompt
      const finalPrompt = promptHead + tempPrompt + `Human: ${question}\nAI: `
      if (getTokenLength(finalPrompt) <= MAX_TOKEN_LENGTH -
        MAX_GENERATE_TOKEN_LENGTH) {
        prompt = tempPrompt
      } else break
    }

    const finalPrompt = promptHead + prompt + `Human: ${question}\nAI: `
    console.debug(finalPrompt)

    const result = await openai.createCompletion({
      model: 'text-davinci-003',
      prompt: finalPrompt,
      max_tokens: MAX_GENERATE_TOKEN_LENGTH,
      temperature: 0.9,
      top_p: 1,
      frequency_penalty: 0.0,
      presence_penalty: 0.6,
      stop: ['Human:', 'AI:']
    })
    const answer = result.data.choices[0].text!.trim()
    console.info(`[OpenAI] Reply to ${userID}: ${answer}`)

    // save to session with 1 day ttl
    session.push([question, answer])
    cache.set(`session:${userID}`, session, 3600 * 24)

    return answer
  } catch (error: any) {
    if (error.response) {
      const errorMessage = `[ERROR:${error.response.status}] ${JSON.stringify(
        error.response.data)}`
      console.warn(errorMessage)
      return errorMessage
    } else if (error.message) {
      const errorMessage = `[ERROR] ${error.message}`
      console.warn(errorMessage)
      return errorMessage
    } else {
      const errorMessage = `[ERROR] LarkGPT is unavailable now. Please try again later.`
      console.warn(`[ERROR] Unknown error occurred.`)
      return errorMessage
    }
  }
}

const eventDispatcher = new lark.EventDispatcher({
  encryptKey: env.LARK_ENCRYPT_KEY
}).register({
  'im.message.receive_v1': async (data) => {
    // handle each message only once
    const messageID = data.message.message_id
    if (!!cache.get(`message_id:${messageID}`)) return { code: 0 }
    cache.set(`message_id:${messageID}`, true, 300)

    const userID = data.sender.sender_id?.user_id || 'common'

    const messageHandler = async (content: string) => {
      if (content === '/reset') {
        cache.del(`session:${userID}`)
        return await reply(messageID, '[COMMAND] Session reset successfully.')
      } else {
        const answer = await createCompletion(userID, content)
        return await reply(messageID, answer)
      }
    }

    // private chat
    if (data.message.chat_type === 'p2p') {
      if (data.message.message_type === 'text') {
        const userInput = JSON.parse(data.message.content)
        await messageHandler(userInput.text)
      }
    }

    // group chat, need to @ bot
    if (data.message.chat_type === 'group') {
      if (data.message.mentions &&
        data.message.mentions.length > 0 && data.message.mentions[0].name ===
        env.LARK_APP_NAME) {
        const userInput = JSON.parse(data.message.content)
        await messageHandler(userInput.text.replace('@_user_1', '').trim())
      }

    }
    return { code: 0 }
  }
})

app.use('/', lark.adaptExpress(eventDispatcher, {
  autoChallenge: true
}))

app.listen(env.PORT, () => {
  console.info(`[LarkGPT] Now listening on port ${env.PORT}`)
})
