import 'dotenv/config';
import { streamText } from 'ai';
import { getChatModel, getLlm } from '../llm/provider';

async function main() {
  const { config } = getLlm();
  console.log(`LLM endpoint: ${config.baseUrl}`);
  console.log(`LLM model:    ${config.model}`);
  console.log('--- streaming output ---');

  const result = streamText({
    model: getChatModel(),
    prompt: '请用一句话友好地介绍你自己。',
  });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n--- done ---\n');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});