# N8N Automation imports

Ready-made n8n workflows. Each `.json` file in this folder can be imported into n8n as it is (Workflows → Import from file). All code the workflow needs is inside the file.

| File | What it does |
| --- | --- |
| `Clinical Decision Helper.json` | A form that accepts clinical images, reads them with Gemini, reasons with DeepSeek and emails a fixed-layout report. |

## Clinical Decision Helper

### What it does

1. **Form.** When the workflow is published, the first node gives a public form with three fields: one or more clinical images (photos or scans of lab reports, imaging reports, notes, ECGs, skin findings), an optional email address, and an optional box for clinical notes and questions.
2. **Read the images.** Gemini transcribes every image word for word. Laboratory results become tables with test, result, unit, reference range and flag. Unreadable parts are marked `[unclear]`. Names and ID numbers are replaced with `[REDACTED]`.
3. **Reason.** The transcript and the clinician's notes go to DeepSeek with a strict instruction set. It returns one JSON object: case summary, key findings, probable diagnosis with a confidence percentage, three to five differential diagnoses (each with a percentage, a short rationale and a distinguishing feature), a management plan (immediate actions, investigations, treatment, monitoring, red flags) and data gaps.
4. **Report.** A Code node renders that JSON into an HTML email with one fixed layout, font and colour scheme, so every report looks the same whatever the model wrote. The full transcript is appended and the original images are attached.
5. **Send.** Gmail sends the report to the address typed in the form. If the field is empty or invalid, the report goes to the default address set in the *Build report email* node.

### Models used

| Step | Model | Why |
| --- | --- | --- |
| Image reading | `gemini-3.8-flash` | Current stable Flash model. It accepts images natively, reads printed tables and small print reliably, and is priced at the promotional Flash rate (0.75 USD per million input tokens). A typical run costs well under one cent. |
| Reasoning | `deepseek-v4-pro` | Stronger clinical reasoning than `deepseek-flash`; thinking mode is on by default. A typical run costs one to three cents. |

Cheaper alternatives: `gemini-3.5-flash-lite` (0.30 USD per million input tokens) for image reading, and `deepseek-flash` for reasoning. Change them in the *Read images (Gemini)* and *DeepSeek Chat Model* nodes. Avoid the Flash-Lite models for handwritten or poor-quality photographs, because small numbers on lab sheets are misread more often.

### Import and set-up

1. In n8n, choose **Workflows → Import from file** and pick `Clinical Decision Helper.json`.
2. Open these nodes and select the credentials you already have: *Read images (Gemini)* (Google Gemini / PaLM API), *DeepSeek Chat Model* (DeepSeek API) and *Send report (Gmail)* (Gmail OAuth2).
3. Optional: change the default recipient in the *Build report email* node (the `DEFAULT_EMAIL` line near the top).
4. Publish the workflow. Open the *Clinical form* node and copy the **Production URL**. That is the form link.

### Requirements

- n8n with the Google Gemini node, the DeepSeek Chat Model node and the Gmail node (any n8n release from mid-2025 onwards).
- Credentials for Gemini, DeepSeek and Gmail already created in n8n.

### Tests

From this folder:

```
python -m unittest discover -s tests
```

The tests check that the import file is well formed, that every connection points at a real node, that the form fields and models are set as described, and that each Code node contains valid JavaScript (Node.js is used for the syntax check when it is installed).

### Safety note

The report supports clinical judgement and does not replace it. It has not been reviewed by a clinician, and it may contain reading or reasoning errors. Every value should be checked against the original documents.
