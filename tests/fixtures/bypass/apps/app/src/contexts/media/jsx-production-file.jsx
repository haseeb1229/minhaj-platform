// FIXTURE — MUST FAIL. Same bypass in .jsx form.
import { sendMessage } from '@/contexts/messaging';
export const Component = () => sendMessage();
