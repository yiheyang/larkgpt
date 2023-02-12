import express from 'express'
import * as lark from '@larksuiteoapi/node-sdk'
import bodyParser from 'body-parser'
import { Configuration, OpenAIApi } from 'openai'
import nodeCache from 'node-cache'
import dotenv from 'dotenv'
import { encode } from 'gpt-3-encoder'
import https from 'https'

const cache = new nodeCache()

dotenv.config()
const env = process.env

const app = express()
app.use(bodyParser.json())

const client = new lark.Client({
  appId: env.LARK_APP_ID || '',
  appSecret: env.LARK_APP_SECRET || '',
  domain: env.LARK_DOMAIN || lark.Domain.Feishu
})

const configuration = new Configuration({
  apiKey: env.OPENAI_API_KEY
})
const openai = new OpenAIApi(configuration)

const MAX_TOKEN_LENGTH = Number(env.MAX_TOKEN_LENGTH) || 4096
const MAX_GENERATE_TOKEN_LENGTH = Number(env.MAX_GENERATE_TOKEN_LENGTH) || 1024
const INIT_COMMAND = env.INIT_COMMAND ||
  'The following is a conversation with an AI assistant. The assistant is helpful, creative, clever, and very friendly.'
const TEXT_MODEL = env.TEXT_MODEL || 'text-davinci-003'
const IMAGE_SIZE = env.IMAGE_SIZE || '1024x1024'

async function reply (
  messageID: string, content: string) {
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

async function downloadFile (url: string) {
  return new Promise<Buffer>((resolve, reject) => {
    https.get(url, function (response) {
      if (response.statusCode !== 200) {
        reject(new Error('Failed to download image.'))
      }
      response.setEncoding('binary')
      let imageData = ''
      response.on('data', function (chunk) {
        imageData += chunk
      })
      response.on('end', function () {
        const buffer = Buffer.from(imageData, 'binary')
        resolve(buffer)
      })
    })
  })

}

async function replyImage (
  messageID: string, imageKey: string) {
  return await client.im.message.reply({
    path: {
      message_id: messageID
    },
    data: {
      content: JSON.stringify({
        'image_key': imageKey
      }),
      msg_type: 'image'
    }
  })
}

function getTokenLength (content: string) {
  return encode(content).length
}

function errorHandler (error: any) {
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

async function createCompletion (userID: string, question: string) {
  console.info(`[Lark] Receive from ${userID}: ${question}`)

  try {
    let session: [string, string][] = cache.get(`session:${userID}`) || []
    let promptHead = `${INIT_COMMAND}\n\n`
    let prompt = ''
    for (let index = session.length - 1; index >= 0; index--) {
      const [q, a] = session[index]
      const tempPrompt = `Human: ${q}\nAI: ${a}\n` + prompt
      const finalPrompt = promptHead + tempPrompt + `Human: ${question}\nAI: `
      if (getTokenLength(finalPrompt) <= MAX_TOKEN_LENGTH -
        MAX_GENERATE_TOKEN_LENGTH) {
        prompt = tempPrompt
      } else break
    }

    const finalPrompt = promptHead + prompt + `Human: ${question}\nAI: `

    const result = await openai.createCompletion({
      model: TEXT_MODEL,
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
    // need to get the latest data again
    session = cache.get(`session:${userID}`) || []
    session.push([question, answer])
    cache.set(`session:${userID}`, session, 3600 * 24)

    return answer
  } catch (error: any) {
    throw errorHandler(error)
  }
}

async function createImage (userID: string, prompt: string) {
  console.info(`[Lark] Receive from ${userID}: /img ${prompt}`)

  try {
    const result = await openai.createImage({
      prompt: prompt,
      n: 1,
      size: IMAGE_SIZE as any
    })
    const url = result.data.data[0].url || ''
    if (!url) throw new Error('Failed to create image.')

    const imgBuffer = await downloadFile(url)
    const uploadedImg: { image_key?: string | undefined; } = await client.im.image.create(
      {
        data: { image: imgBuffer, image_type: 'message' }
      })
    if (!uploadedImg.image_key) throw new Error(
      'Failed to upload image to Lark.')

    console.info(`[OpenAI] Reply image to ${userID}: ${uploadedImg.image_key}`)
    return uploadedImg.image_key
  } catch (error) {
    throw errorHandler(error)
  }
}

const eventDispatcher = new lark.EventDispatcher({
  encryptKey: env.LARK_ENCRYPT_KEY
}).register({
  'im.message.receive_v1': async (data) => {
    // handle each message only once
    const messageID = data.message.message_id
    if (!!cache.get(`message_id:${messageID}`)) return { code: 0 }
    cache.set(`message_id:${messageID}`, true, 3600)

    const userID = data.sender.sender_id?.user_id || 'common'

    const messageHandler = async (content: string) => {
      try {
        if (content === '/reset') {
          cache.del(`session:${userID}`)
          return await reply(messageID, '[COMMAND] Session reset successfully.')
        } else if (content.match(/^\/img \S+/)) {
          const imageKey = await createImage(userID,
            content.replace(/^\/img /, ''))
          return await replyImage(messageID, imageKey)
        } else {
          const answer = await createCompletion(userID, content)
          return await reply(messageID, answer)
        }
      } catch (errorMessage) {
        if (typeof errorMessage === 'string') {
          return await reply(messageID, errorMessage)
        }
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
