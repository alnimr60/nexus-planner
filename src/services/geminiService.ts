import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

/**
 * Helper to call Gemini with a simple retry for transient RPC/XHR errors
 */
async function callGeminiWithRetry(params: any, retries = 2): Promise<any> {
  let lastError: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (error: any) {
      lastError = error;
      // If it's a transient status code (500, 503, 504) or an XHR error
      const errorMsg = error?.message || "";
      const isTransient = errorMsg.includes("Rpc failed") || errorMsg.includes("xhr error") || [500, 503, 504].includes(error?.status);
      
      if (isTransient && i < retries) {
        // Wait a bit before retrying (500ms, 1000ms)
        await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function generateNarrative(data: {
  userName: string;
  subjects: any[];
  lectures: any[];
  exams: any[];
  tasks: any[];
  weights?: any;
}) {
  try {
    const prompt = `
      You are Nexus, a highly intelligent and proactive productivity assistant.
      Given the following user data, generate a concise, human-readable narrative summary for their dashboard.
      The summary should be exactly 2-3 sentences. 
      Highlight their main focus, upcoming exams, and immediate next steps.
      Be direct, professional yet encouraging.
      
      User: ${data.userName}
      Current Tasks: ${data.tasks.filter(t => !t.completed).map(t => t.title).join(", ")}
      Upcoming Exams: ${data.exams.map(e => `${e.name} in ${Math.ceil((new Date(e.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))} days`).join(", ")}
      Lectures in progress: ${data.lectures.filter(l => l.progress > 0 && l.progress < 1).map(l => l.title).join(", ")}
      
      Example output: "Today, your main focus is **Lecture 04: Thermodynamics**. You have **3 tasks** to finish before your **Midterm Exam** in 5 days. You should start by reviewing **Heat Transfer** for 40 minutes."
      
      Use markdown bolding for key terms.
    `;

    const response = await callGeminiWithRetry({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    return response.text || "Welcome back! Let's see what we can achieve today.";
  } catch (error: any) {
    if (error?.status === 403 || error?.message?.includes('PERMISSION_DENIED')) {
      return "Nexus AI is currently limited by API permissions. Please check your **API Key** in settings or switch to **Standard mode** in the Engine tab.";
    }
    // Suppress noisy internal RPC errors for the user but log it for debugging
    console.warn("Nexus AI Narrator encountered an issue. Falling back to default message.");
    return "Welcome back! Ready to focus on your goals?";
  }
}

export async function processPulsePrompt(prompt: string) {
  try {
    const response = await callGeminiWithRetry({
      model: "gemini-3-flash-preview",
      contents: `
        The user said: "${prompt}"
        Extract the intent and return a JSON object.
        Possible intents: "add_task", "add_lecture", "add_subject", "add_exam", "bulk_import", "unknown".
        
        For "add_task": include "title", "subjectId" (if mentioned), "dueDate" (ISO string).
        For "add_lecture": include "title", "subjectId" (if mentioned), "pageCount" (default 10), "date" (ISO string).
        For "add_subject": include "name".
        For "add_exam": include "name", "date" (ISO string).
        For "bulk_import": the user provided a list or syllabus. Return "items" as an array of objects, each with "type" ("lecture"|"task"|"exam"|"subject") and its properties.
        
        Current Time: ${new Date().toISOString()}
        If a subject is mentioned by name, try to match it.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: { type: Type.STRING, enum: ["add_task", "add_lecture", "add_subject", "add_exam", "bulk_import", "unknown"] },
            title: { type: Type.STRING },
            name: { type: Type.STRING },
            subjectId: { type: Type.STRING },
            date: { type: Type.STRING },
            dueDate: { type: Type.STRING },
            pageCount: { type: Type.NUMBER },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, enum: ["lecture", "task", "exam", "subject"] },
                  title: { type: Type.STRING },
                  name: { type: Type.STRING },
                  date: { type: Type.STRING },
                  dueDate: { type: Type.STRING },
                  pageCount: { type: Type.NUMBER },
                  subjectId: { type: Type.STRING }
                },
                required: ["type"]
              }
            }
          },
          required: ["intent"]
        }
      }
    });
    
    return JSON.parse(response.text || "{}");
  } catch (error: any) {
    if (error?.status === 403 || error?.message?.includes('PERMISSION_DENIED')) {
      console.error("AI Permission Denied during pulse processing");
    } else {
      console.error("Error processing pulse prompt:", error);
    }
    return { intent: "unknown" };
  }
}
