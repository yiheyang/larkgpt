# LarkGPT

LarkGPT is a bot application running OpenAI's text completion engine and image generation engine for Lark (Feishu).

## How to use?

1. Clone the project.
```bash
git clone https://github.com/yiheyang/larkgpt.git
```
2. Install dependencies.
```bash
yarn # or `npm install`
```
3. Configure your LarkGPT.
```bash
cp .env.example .env

# Edit .env
```
4. Start your LarkGPT.
```bash
yarn start # or `npm start`
```
## Command
```text
/reset # Reset user's session context
/img <prompt> # Generate an image with the given prompt
```
## LICENCE
This project is under the protection of MIT license.
