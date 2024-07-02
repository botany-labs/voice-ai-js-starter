#!/usr/bin/env node
const { execSync } = require('child_process');
const chalk = require('chalk');
const inquirer = require('inquirer');
const fs = require('fs');

async function main() {
    console.log(chalk.green.bold("Welcome to the quickstart setup for botany-labs/voice-ai-js-starter!"));
    console.log(chalk.green("You're 30 seconds away from creating an amazing voice app.\n"));
    console.log(chalk.magenta("For more help, see https://github.com/botany-labs/voice-ai-js-starter\n"));

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'directory',
            message: 'What directory would you like to create your voice app in?',
            default: './my-voice-app'
        },
        {
            type: 'input',
            name: 'assistantFunction',
            message: 'What would you like your voice assistant to do? (Don\'t worry you can change this later)\n',
            default: 'You are a chatty AI assistant that makes lovely conversation about the weather.'
        },
        {
            type: 'list',
            name: 'configuration',
            message: 'Which pre-made configuration would you like to use? (If you want to do more configuration, just choose easiest for now)',
            choices: [
                { name: `Easy Setup (STT: OpenAI Whisper, TTS: OpenAI TTS-1, LLM: OpenAI ChatGPT 3.5 Turbo) ${chalk.bold('[RECOMMENDED]')}`, value: 'easy' },
                { name: `Fastest Performance (STT: Deepgram Nova-2, TTS: Deepgram Aura, LLM: OpenAI ChatGPT 3.5 Turbo)`, value: 'fastest' },
                { name: `Best Quality (STT: OpenAI Whisper, TTS: Eleven Labs Turbo V2, LLM: OpenAI ChatGPT 3.5 Turbo)`, value: 'best' }
            ]
        }
    ]);

    let apiKeys = {};
    if (answers.configuration === 'easy') {
        apiKeys.openai = (await inquirer.prompt({
            type: 'input',
            name: 'openai',
            message: `You selected ${chalk.magenta.bold('Easy Setup')}. This will require you to provide your ${chalk.yellow.bold('OpenAI API key')}:`,
        })).openai;
    } else if (answers.configuration === 'fastest') {
        apiKeys.openai = (await inquirer.prompt({
            type: 'input',
            name: 'openai',
            message: `You selected ${chalk.magenta.bold('Fastest Performance')}. This will require you to provide your ${chalk.yellow.bold('OpenAI API key')}:`,
        })).openai;
        apiKeys.deepgram = (await inquirer.prompt({
            type: 'input',
            name: 'deepgram',
            message: `You selected ${chalk.magenta.bold('Fastest Performance')}. This will require you to provide your ${chalk.yellow.bold('Deepgram API key')}:`,
        })).deepgram;
    } else if (answers.configuration === 'best') {
        apiKeys.openai = (await inquirer.prompt({
            type: 'input',
            name: 'openai',
            message: `You selected ${chalk.magenta.bold('Best Quality')}. This will require you to provide your ${chalk.yellow.bold('OpenAI API key')}:`,
        })).openai;
        apiKeys.elevenLabs = (await inquirer.prompt({
            type: 'input',
            name: 'elevenLabs',
            message: `You selected ${chalk.magenta.bold('Best Quality')}. This will require you to provide your ${chalk.yellow.bold('Eleven Labs API key')}:`,
        })).elevenLabs;
    }

    console.log(chalk.yellow("\nThanks for all that! Double check to confirm your settings:\n"));
    console.log(`${chalk.cyan.bold('Directory:')} ${answers.directory}`);
    console.log(`${chalk.cyan.bold('Assistant Function:')} ${answers.assistantFunction}`);
    console.log(`${chalk.cyan.bold('Configuration:')} ${answers.configuration}`);
    console.log(`${chalk.cyan.bold('API Keys:')} ${JSON.stringify(apiKeys, null, 2)}`);

    const confirm = await inquirer.prompt({
        type: 'confirm',
        name: 'isCorrect',
        message: 'Is everything correct?',
        default: true
    });

    if (!confirm.isCorrect) {
        console.log(chalk.red("Setup aborted. Please run the setup again."));
        return;
    }

    console.log(chalk.green("\nGreat! One moment...\n"));

    // Make directory
    execSync(`mkdir -p ${answers.directory}`, { stdio: 'inherit' });

    // Clone the web and server directories into the new directory
    execSync(`git clone https://github.com/botany-labs/voice-ai-js-starter/ ${answers.directory}`, { stdio: 'inherit' });

    // Remove unnecessary files and directories from the cloned project
    clearUnnecessaryFilesAndDirectoriesFromClonedProject(answers.directory);

    // Make server dotenv file
    const contents = `# .env
    OPENAI_API_KEY=${apiKeys.openai}
    DEEPGRAM_API_KEY=${apiKeys.deepgram}
    ELEVENLABS_API_KEY=${apiKeys.elevenLabs}
    `;
    fs.writeFileSync(`${answers.directory}/server/.env`, contents);

    // Prepare index.js
    prepareIndexJS(answers.directory, answers.assistantFunction, preparedConfigurationToOptions[answers.configuration]);
    
    console.log(chalk.green("Installing dependencies..."));
    execSync(`cd ${answers.directory}/web && npm install`, { stdio: 'inherit' });
    execSync(`cd ${answers.directory}/server && npm install`, { stdio: 'inherit' });

    console.log(chalk.magenta.bold("\nSuccess!"));
    console.log(chalk.magenta.bold("\nNext, simply..."));
    console.log(chalk.green(`Run ${chalk.cyan.bold('npm run start')} in ${chalk.cyan.bold(`${answers.directory}/web`)} to start your client.`));
    console.log(chalk.green(`Run ${chalk.cyan.bold('npm run start')} in ${chalk.cyan.bold(`${answers.directory}/server`)} to start your voice assistant server.`));
}

main().catch(error => {
    console.error(chalk.red(error));
});


const prepareIndexJS = (dir, assistantPrompt, configuration) => {
    // In server/index.starter.js, there are two comment lines like this : // ----------------------------
    // We need to replace the code between those lines with the configuration I provide here:

    const replacementContent =`
const MyAssistant = new Assistant(
    "${assistantPrompt}",
    {
        llmModel: "${configuration.llmModel}",
        speechToTextModel: "${configuration.speechToTextModel}",
        voiceModel: "${configuration.voiceModel}",
        voiceName: "${configuration.voiceName}",
    }
  );
`   
    // Delete index.js
    fs.unlinkSync(`${dir}/server/index.js`);

    // Replace the code between the two comment lines with the replacementContent
    const indexJSContent = fs.readFileSync(`${dir}/server/index.starter.js`, 'utf8');
    const indexJSContentLines = indexJSContent.split('\n');
    const startIndex = indexJSContentLines.findIndex(line => line.includes('// ----------------------------'));
    const endIndex = indexJSContentLines.findIndex((line, idx) => idx > startIndex && line.includes('// ----------------------------'));
    const updatedIndexJSContent = indexJSContentLines.slice(0, startIndex).concat(replacementContent).concat(indexJSContentLines.slice(endIndex)).join('\n');
    fs.writeFileSync(`${dir}/server/index.js`, updatedIndexJSContent);

    // Delete index.starter.js
    fs.unlinkSync(`${dir}/server/index.starter.js`);
}


const preparedConfigurationToOptions = {
    "easy": {
        llmModel: "gpt-3.5-turbo",
        speechToTextModel: "openai/whisper-1",
        voiceModel: "openai/tts-1",
        voiceName: "shimmer",
    },
    "fastest": {
        llmModel: "gpt-3.5-turbo",
        speechToTextModel: "deepgram:live/nova-2",
        voiceModel: "deepgram/aura",
        voiceName: "asteria-en",
    },
    "best": {
        llmModel: "gpt-3.5-turbo",
        speechToTextModel: "openai/whisper-1",
        voiceModel: "elevenlabs/eleven_turbo_v2",
        voiceName: "piTKgcLEGmPE4e6mEKli",
    }
}

const toKeepFromClone = [
    "server",
    "web",
    ".gitignore",
    "LICENSE",
    "README.md",
]

const clearUnnecessaryFilesAndDirectoriesFromClonedProject = (dir) => {
    // List directories and files in the cloned project
    const filesAndDirectories = fs.readdirSync(dir);
    // Delete all files and directories that are not in toKeepFromClone
    filesAndDirectories.forEach(fileOrDirectory => {
        const filePath = `${dir}/${fileOrDirectory}`;
        const stats = fs.lstatSync(filePath);
        if (!toKeepFromClone.includes(fileOrDirectory)) {
            if (stats.isDirectory()) {
                execSync(`rm -rf ${filePath}`, { stdio: 'inherit' });
            } else {
                fs.unlinkSync(filePath);
            }
        }
    });
}

