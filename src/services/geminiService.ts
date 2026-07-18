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

/**
 * Clean Markdown JSON wrapping if any
 */
function cleanJsonString(str: string): string {
  let cleaned = str.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }
  return cleaned;
}

/**
 * Call OpenRouter with the saved configuration
 */
async function callOpenRouter(prompt: string, isJson: boolean = false): Promise<string> {
  const apiKey = localStorage.getItem("focus_openrouter_api_key") || "";
  const model = localStorage.getItem("focus_openrouter_model") || "meta-llama/llama-3.3-70b-instruct:free";

  if (!apiKey) {
    throw new Error("OpenRouter API Key is missing. Please set it in Settings.");
  }

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": window.location.origin,
    "X-Title": "PixelHint Focus"
  };

  const body: any = {
    model: model,
    messages: [
      {
        role: "user",
        content: prompt
      }
    ]
  };

  if (isJson) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const choiceText = data.choices?.[0]?.message?.content;
  if (!choiceText) {
    throw new Error("No response returned from OpenRouter.");
  }

  return choiceText;
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

    const provider = localStorage.getItem("focus_ai_provider") || "gemini";
    if (provider === "openrouter") {
      return await callOpenRouter(prompt, false);
    }

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
    console.warn("Nexus AI Narrator encountered an issue. Falling back to default message.", error);
    return `Welcome back! Ready to focus on your goals? ${error?.message ? `(${error.message})` : ""}`;
  }
}

export async function processPulsePrompt(prompt: string) {
  try {
    const provider = localStorage.getItem("focus_ai_provider") || "gemini";
    if (provider === "openrouter") {
      const openRouterPrompt = `
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

        IMPORTANT: Return ONLY a valid, parseable JSON object matching the requested schema. No conversational filler, no explanations, no markdown fences.
      `;
      const text = await callOpenRouter(openRouterPrompt, true);
      const jsonStr = cleanJsonString(text);
      return JSON.parse(jsonStr || "{}");
    }

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

export async function analyzeSmartLectures(
  input: string,
  subjects: any[],
  existingLectures: any[]
): Promise<any> {
  const provider = localStorage.getItem("focus_ai_provider") || "gemini";
  
  const prompt = `
    You are an AI syllabus analyzer. 
    The user is importing a list of lectures/topics. Some might already be in the database, and some are new.
    Compare the input list of lectures against the existing subjects and existing lectures provided below.
    
    Existing Subjects:
    ${JSON.stringify(subjects.map(s => ({ id: s.id, name: s.name })))}
    
    Existing Lectures:
    ${JSON.stringify(existingLectures.map(l => ({ id: l.id, title: l.title, subjectId: l.subjectId })))}
    
    User Input list of lectures:
    """
    ${input}
    """
    
    For each lecture found in the User Input list:
    1. Parse its title, and optionally its pageCount or week if specified.
    2. Match it to one of the Existing Subjects by name/topic similarity. If no existing subject matches, match to null (or the first subject).
    3. Determine if it is a duplicate of, or extremely similar to, any of the Existing Lectures (within the same matched subject or overall).
       - If it's already present (even if slightly different wording, e.g. "Lecture 1: Intro" vs "Introduction"), set status to "ignore".
       - If it's a new lecture, set status to "add".
    4. Provide a clear, short reason (e.g. "Similar to existing: 'Intro to Programming'", "New lecture detected for Math").
    
    Return a JSON object with a single "items" key containing an array of these analyzed lectures:
    {
      "items": [
        {
          "title": "...",
          "subjectId": "...", // ID of the matched existing subject (or null if none)
          "subjectName": "...", // Name of the matched existing subject (or "General" if none)
          "status": "add" | "ignore",
          "reason": "...",
          "pageCount": 10, // default 10 if not found
          "week": 1 // default 1 if not found
        }
      ]
    }
    
    Do not return any conversational text. Return only the JSON structure.
  `;

  try {
    if (provider === "openrouter") {
      const text = await callOpenRouter(prompt, true);
      const jsonStr = cleanJsonString(text);
      return JSON.parse(jsonStr || '{"items": []}');
    }

    const response = await callGeminiWithRetry({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  subjectId: { type: Type.STRING },
                  subjectName: { type: Type.STRING },
                  status: { type: Type.STRING, enum: ["add", "ignore"] },
                  reason: { type: Type.STRING },
                  pageCount: { type: Type.NUMBER },
                  week: { type: Type.NUMBER }
                },
                required: ["title", "status", "reason"]
              }
            }
          },
          required: ["items"]
        }
      }
    });

    return JSON.parse(response.text || '{"items": []}');
  } catch (error: any) {
    console.error("Error analyzing smart lectures:", error);
    // Fallback: simple line by line matching
    const lines = input.split('\n').filter(l => l.trim());
    const items = lines.map(line => {
      const title = line.trim();
      const existing = existingLectures.find(l => l.title.toLowerCase().trim() === title.toLowerCase());
      return {
        title,
        subjectId: existing ? existing.subjectId : (subjects[0]?.id || null),
        subjectName: existing ? (subjects.find(s => s.id === existing.subjectId)?.name || "General") : (subjects[0]?.name || "General"),
        status: existing ? "ignore" : "add",
        reason: existing ? `Similar to existing: '${existing.title}'` : "New lecture detected",
        pageCount: 10,
        week: 1
      };
    });
    return { items };
  }
}


