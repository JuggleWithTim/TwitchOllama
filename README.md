# TwitchOllama
Twitch chatbot using chat history as context for Ollama or OpenAI LLMs

## Features
* Responds to mentions
* Optional adjustable timer where the bot automatically engages with chat when it's not been mentioned for a set amount of time.
* Adjustable context length (how many messages back it has knowledge about)
* Support for reasoning models (hides think tags and its content from chat output)
* Option to use OpenAI's API instead of a local Ollama model

## Chat commands
* !aiauto - Toggle auto-messages on/off
* !aitimer \<minutes\> - Set auto-message timer
* !aisysprompt \<new prompt\> - Update system prompt
* !aicontext \<number\> - Set context history length (1-50) (how many messages it has knowledge about)
* !aistop - Pause the bot
* !aistart - Resume the bot
* !aihelp - Show list of commands

## Cloud hosting
If you don't want to bother setting this up yourself and want it always available in the cloud. I provide hosting of this bot for [Patreon](patreon.com/JuggleWithTim) supporters.
(NOTE: Only available with OpenAI models because my server has no GPU)

## Installation
### 1. Prerequisites
* [Node.js](https://nodejs.org/) (version 16 or higher) installed.
* An [Ollama](https://ollama.com/) instance running locally. (Not needed if using OpenAI's API)
* A Twitch account for the bot and an [OAuth](https://twitchtokengenerator.com/) token.

### 2. Clone the Repository (or download and unpack zip)
`git clone https://github.com/JuggleWithTim/TwitchOllama.git`

### 3. Install Dependencies
* Open the command prompt and navigate to the folder containing bot.js
`cd /path/to/TwitchOllama`
* Install required npm packages with `npm install tmi.js axios openai`
* Make sure Ollama has the model you want to use installed. Run `ollama run llama3.2` in the command prompt to install the default model.

### 4. Configure the Bot
* Open `bot.js` in a text editor
* Fill in all required settings in the settings block near the top of the document. This is the default settings when the bot is started, some settings can be changed with commands during runtime.
* Adjust the system prompt from line 24 to your liking.

### 5. Run the bot
* Make sure your command prompt is navigated to the bots folder. `cd /path/to/TwitchOllama`
* Start the bot by running `node bot.js` in your command prompt
