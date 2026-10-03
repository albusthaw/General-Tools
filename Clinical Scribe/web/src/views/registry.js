// Which screen draws each route. Each screen returns an optional clean-up function.
import { renderAiSettings } from "./admin/ai.js";
import { renderAudit } from "./admin/audit.js";
import { renderEmail } from "./admin/email.js";
import { renderGoogle } from "./admin/google.js";
import { renderRecordings } from "./admin/recordings.js";
import { renderReview } from "./admin/review.js";
import { renderUsers } from "./admin/users.js";
import { renderPhoneApps } from "./phone-apps.js";
import { renderHistory } from "./scribe/history.js";
import { renderHistoryDetail } from "./scribe/history-detail.js";
import { renderRecord } from "./scribe/record.js";
import { renderTemplates } from "./scribe/templates.js";

export const VIEWS = {
  scribe: renderRecord,
  templates: renderTemplates,
  history: renderHistory,
  "history-detail": renderHistoryDetail,
  apps: renderPhoneApps,
  "admin-users": renderUsers,
  "admin-ai": renderAiSettings,
  "admin-recordings": renderRecordings,
  "admin-review": renderReview,
  "admin-audit": renderAudit,
  "admin-google": renderGoogle,
  "admin-email": renderEmail,
};
