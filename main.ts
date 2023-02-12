import express from 'express'
import * as lark from '@larksuiteoapi/node-sdk'
import bodyParser from 'body-parser'
import { Configuration, OpenAIApi } from 'openai'
import nodeCache from 'node-cache'
import dotenv from 'dotenv'

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

// 回复消息
async function reply (messageId: string, content: string) {
  return await client.im.message.reply({
    path: {
      message_id: messageId
    },
    data: {
      content: JSON.stringify({
        'text': content
      }),
      msg_type: 'text'
    }
  })
}

// 通过 OpenAI API 获取回复
async function getOpenAIReply (content: string) {
  const prompt = 'Q: ' + content + '\nA: '

  const result = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt: prompt,
    max_tokens: 1200,
    temperature: 0.9,
    top_p: 1,
    frequency_penalty: 0.0,
    presence_penalty: 0.0,
    stop: ['\n\n\n'],
    stream: false
  })

  return result.data.choices[0].text!.replace('\n\n', '').trim()
}

const eventDispatcher = new lark.EventDispatcher({
  encryptKey: env.LARK_ENCRYPT_KEY
}).register({
  'verification': async (data: any) => {
    console.log(data)
  },
  'im.message.receive_v1': async (data: any) => {
    const { event_id } = data

    // 对于同一个事件，只处理一次
    const event = cache.get('event:' + event_id)
    if (event !== undefined) return { code: 0 }
    cache.set('event:' + event_id, true, 300)

    let messageId = data.message.message_id

    // 私聊直接回复
    if (data.message.chat_type === 'p2p') {
      // 不是文本消息，不处理
      if (data.message.message_type !== 'text') {
        await reply(messageId, '暂不支持其他类型的提问')
      }
      // 是文本消息，直接回复
      const userInput = JSON.parse(data.message.content)
      const openaiResponse = await getOpenAIReply(userInput.text)
      await reply(messageId, openaiResponse)
    }

    // 群聊，需要 @ 机器人
    if (data.message.chat_type === 'group') {
      // 这是日常群沟通，不用管
      if (!data.message.mentions ||
        data.message.mentions.length === 0) {
        return { code: 0 }
      }
      // 没有 mention 机器人，则退出。
      if (data.message.mentions[0].name !== env.BOT_NAME) {
        return { code: 0 }
      }
      const userInput = JSON.parse(data.message.content)
      const question = userInput.text.replace('@_user_1', '')
      const openaiResponse = await getOpenAIReply(question)
      return await reply(messageId, openaiResponse)
    }
    return { code: 0 }
  }
} as any)

app.use('/', lark.adaptExpress(eventDispatcher))

app.listen(env.PORT, () => {
  console.log(`LarkGPT is now listening on port ${env.PORT}`)
})
