// Environment configuration validation and defaults

export interface AppConfig {
  databaseUrl: string;
  isDemoMode: boolean;
  isSyntheticData: boolean;
  demoForceExecutionFailure: boolean;
  aiProvider: 'mock' | 'gemini' | 'openai';
  geminiApiKey?: string;
  razorpay: {
    keyId: string;
    keySecret: string;
    isTestMode: boolean;
  };
  appUrl: string;
}

export const config: AppConfig = {
  databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
  isDemoMode: process.env.DEMO_MODE !== 'false',
  isSyntheticData: process.env.IS_SYNTHETIC_DATA !== 'false',
  demoForceExecutionFailure: process.env.DEMO_FORCE_EXECUTION_FAILURE === 'true',
  aiProvider: (process.env.AI_PROVIDER as 'mock' | 'gemini' | 'openai') || 'mock',
  geminiApiKey: process.env.GEMINI_API_KEY,
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || (process.env.DEMO_MODE === 'true' ? 'rzp_test_mock_id' : ''),
    keySecret: process.env.RAZORPAY_KEY_SECRET || (process.env.DEMO_MODE === 'true' ? 'rzp_test_mock_secret' : ''),
    isTestMode: true,
  },
  appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
};

export default config;
