import 'dotenv/config';
import { runCheck } from './checker.js';

try {
  const result = await runCheck({ notify: true });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error);
  process.exit(1);
}
