"use server";

import { redirect } from "next/navigation";
import { canUseApplicationAssistant } from "@/features/ai/access";
import { requireAllowedAiModel } from "@/features/ai/config";
import { createAiConversation } from "@/features/ai/store";
import { requireUser } from "@/lib/auth";

export async function createAiConversationAction(formData: FormData) {
  const user = await requireUser();
  if (!canUseApplicationAssistant(user)) redirect("/forbidden");
  const rawModel = formData.get("modelId");
  const modelId = typeof rawModel === "string" ? rawModel : "";
  const model = await requireAllowedAiModel(user.id, modelId);
  const conversation = await createAiConversation(user.id, model.id);
  redirect(`/assistant/${conversation.id}`);
}
