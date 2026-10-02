// Note templates and the template helper.
import { fromDatabase, fromFunction } from "../errors.js";
import { supabase } from "../supabase.js";

async function call(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw fromDatabase(error);
  return data;
}

export async function listTemplates() {
  const { data, error } = await supabase
    .from("templates")
    .select("id, scope, owner_id, name, description, body, is_default, updated_at")
    .order("is_default", { ascending: false })
    .order("name");
  if (error) throw fromDatabase(error);
  return data ?? [];
}

export const listSharedForAdmin = () => call("admin_list_shared_templates", {});

export const saveTemplate = ({ id = null, name, description, body, sourceRequest = "", scope }) =>
  call("save_template", {
    p_id: id,
    p_name: name,
    p_description: description ?? "",
    p_body: body,
    p_source_request: sourceRequest,
    p_scope: scope,
  });

export const deleteTemplate = (id) => call("delete_template", { p_id: id });
export const restoreTemplate = (id) => call("restore_template", { p_id: id });
export const setDefaultTemplate = (id) => call("set_default_template", { p_id: id });

async function helper(body) {
  const { data, error } = await supabase.functions.invoke("templates-ai", { body });
  if (error) throw await fromFunction(error);
  return data?.data;
}

export const draftTemplate = (description) => helper({ action: "draft", description });

export const reviseTemplate = (current, changes) =>
  helper({ action: "revise", current: { name: current.name, description: current.description ?? "", body: current.body }, changes });
