import * as lark from '@larksuiteoapi/node-sdk'
import {
  ChatCompletionRequestMessage,
  ChatCompletionRequestMessageRoleEnum,
  Configuration,
  OpenAIApi
} from 'openai'
import nodeCache from 'node-cache'
import dotenv from 'dotenv'
import { encode } from 'gpt-3-encoder'
import https from 'https'
import http from 'http'

const cache = new nodeCache()

dotenv.config()
const env = process.env

const server = http.createServer()

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
const HELP_MESSAGE = env.HELP_MESSAGE || `/help help message
/reset # Reset user's session context
/img <prompt> # Generate an image with the given prompt`

async function reply (
  messageID: string, content: string) {
  try {
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
  } catch (error) {
    errorHandler(error)
  }
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
  console.info(`[${env.LARK_APP_NAME}] Receive from ${userID}: ${question}`)

  try {
    let session: [string, string][] = cache.get(`session:${userID}`) || []
    let promptHead = `${INIT_COMMAND} `
    let prompt = ''
    let messages: ChatCompletionRequestMessage[] = []

    for (let index = session.length - 1; index >= 0; index--) {
      const [q, a] = session[index]
      messages.unshift({
        role: ChatCompletionRequestMessageRoleEnum.User,
        content: q
      }, {
        role: ChatCompletionRequestMessageRoleEnum.Assistant,
        content: a
      })
      const tempPrompt = `${q} ${a} ` + prompt
      const finalPrompt = promptHead + tempPrompt + `${question} `
      if (getTokenLength(finalPrompt) <= MAX_TOKEN_LENGTH -
        MAX_GENERATE_TOKEN_LENGTH) {
        prompt = tempPrompt
        messages.shift()
      } else break
    }

    messages.unshift({
      role: ChatCompletionRequestMessageRoleEnum.System,
      content: INIT_COMMAND
    })

    messages.push({
      role: ChatCompletionRequestMessageRoleEnum.User,
      content: question
    })

    const result = await openai.createChatCompletion({
      messages: messages,
      model: TEXT_MODEL,
      max_tokens: MAX_GENERATE_TOKEN_LENGTH,
      temperature: 0.9,
      top_p: 1,
      frequency_penalty: 0.0,
      presence_penalty: 0.6
    })
    const answer = result.data.choices[0].message!.content.trim()
    console.info(`[${env.LARK_APP_NAME}] Reply to ${userID}: ${answer}`)

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
    // check time range
    let currentTime = Date.now()
    if (currentTime - Number(data.message.create_time) > 60 *
      1000) return { code: 0 }

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
        } else if (content === '/help') {
          return await reply(messageID, HELP_MESSAGE)
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
        await messageHandler(
          userInput.text.replace(/@_user_[0-9]+/g, '').trim())
      }

    }
    return { code: 0 }
  }
})

server.on('request',
  lark.adaptDefault('/event', eventDispatcher, { autoChallenge: true }))

server.listen({
  host: env.LISTEN_IP,
  port: env.PORT
})

console.info(`[${env.LARK_APP_NAME}] Now listening on port ${env.PORT}`)
