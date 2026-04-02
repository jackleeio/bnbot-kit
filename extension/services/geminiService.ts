import { GoogleGenAI, Chat, GenerateContentResponse } from "@google/genai";

class GeminiService {
  private client: GoogleGenAI | null = null;
  private chatSession: Chat | null = null;

  constructor() {
    const apiKey = process.env.API_KEY;
    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
    }
  }

  startNewChat() {
    this.chatSession = null;
  }

  private getChatSession() {
    if (!this.client) throw new Error('Gemini API key not configured');
    if (!this.chatSession) {
      this.chatSession = this.client.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: "You are a helpful Twitter (X) assistant. Keep your responses concise, engaging, and suitable for social media context. You are embedded in a sidebar extension.",
        },
      });
    }
    return this.chatSession;
  }

  async sendMessageStream(message: string): Promise<AsyncIterable<string>> {
    const chat = this.getChatSession();
    
    // Create an async generator to yield text chunks
    async function* streamGenerator() {
      const result = await chat.sendMessageStream({ message });
      for await (const chunk of result) {
        const c = chunk as GenerateContentResponse;
        if (c.text) {
          yield c.text;
        }
      }
    }

    return streamGenerator();
  }

  async analyzeTweet(text: string): Promise<string> {
    // Separate call, not part of chat history
    if (!this.client) throw new Error('Gemini API key not configured');
    const response = await this.client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Analyze this tweet for sentiment and potential virality. Keep it short (under 280 chars): "${text}"`,
    });
    return response.text || "Could not analyze tweet.";
  }
}

export const geminiService = new GeminiService();