"""Checks that the Clinical Decision Helper import file is well formed.

Run from the `N8N Automation imports` folder:
    python -m unittest discover -s tests
"""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

FOLDER = Path(__file__).resolve().parent.parent
WORKFLOW = FOLDER / "Clinical Decision Helper.json"


class ClinicalDecisionHelperImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = json.loads(WORKFLOW.read_text(encoding="utf-8"))
        cls.nodes = {node["name"]: node for node in cls.workflow["nodes"]}

    def test_top_level_shape(self):
        self.assertEqual(self.workflow["name"], "Clinical Decision Helper")
        self.assertIsInstance(self.workflow["nodes"], list)
        self.assertIsInstance(self.workflow["connections"], dict)
        self.assertFalse(self.workflow["active"])

    def test_every_node_has_required_keys(self):
        for node in self.workflow["nodes"]:
            for key in ("id", "name", "type", "typeVersion", "position", "parameters"):
                self.assertIn(key, node, f"{node.get('name')} is missing {key}")
        names = [node["name"] for node in self.workflow["nodes"]]
        self.assertEqual(len(names), len(set(names)), "node names must be unique")
        ids = [node["id"] for node in self.workflow["nodes"]]
        self.assertEqual(len(ids), len(set(ids)), "node ids must be unique")

    def test_connections_point_at_real_nodes(self):
        for source, outputs in self.workflow["connections"].items():
            self.assertIn(source, self.nodes, f"connection source {source} does not exist")
            for output_type, branches in outputs.items():
                for branch in branches:
                    for link in branch:
                        self.assertIn(link["node"], self.nodes, f"{source} links to missing {link['node']}")
                        self.assertEqual(link["type"], output_type)

    def test_pipeline_order(self):
        chain = [
            "Clinical form",
            "Prepare images",
            "Read images (Gemini)",
            "Build clinical prompt",
            "Clinical reasoning (DeepSeek)",
            "Build report email",
            "Send report (Gmail)",
        ]
        for current, following in zip(chain, chain[1:]):
            targets = [link["node"] for link in self.workflow["connections"][current]["main"][0]]
            self.assertEqual(targets, [following])
        model_links = self.workflow["connections"]["DeepSeek Chat Model"]["ai_languageModel"][0]
        self.assertEqual(model_links[0]["node"], "Clinical reasoning (DeepSeek)")

    def test_form_fields(self):
        fields = self.nodes["Clinical form"]["parameters"]["formFields"]["values"]
        by_label = {field["fieldLabel"]: field for field in fields}
        self.assertEqual(by_label["Clinical images"]["fieldType"], "file")
        self.assertTrue(by_label["Clinical images"]["multipleFiles"])
        self.assertTrue(by_label["Clinical images"]["requiredField"])
        self.assertEqual(by_label["Email address"]["fieldType"], "email")
        self.assertEqual(by_label["Clinical notes and questions"]["fieldType"], "textarea")

    def test_models_support_images_and_reasoning(self):
        gemini = self.nodes["Read images (Gemini)"]["parameters"]
        self.assertEqual(gemini["resource"], "image")
        self.assertEqual(gemini["operation"], "analyze")
        self.assertEqual(gemini["inputType"], "binary")
        self.assertTrue(gemini["modelId"]["value"].startswith("models/gemini-"))
        deepseek = self.nodes["DeepSeek Chat Model"]["parameters"]
        self.assertTrue(deepseek["model"].startswith("deepseek-"))

    def test_default_recipient_is_present(self):
        code = self.nodes["Build report email"]["parameters"]["jsCode"]
        self.assertIn("minthantthaw@gmail.com", code)
        gmail = self.nodes["Send report (Gmail)"]["parameters"]
        self.assertEqual(gmail["sendTo"], "={{ $json.recipient }}")
        self.assertEqual(gmail["emailType"], "html")

    def test_code_nodes_are_valid_javascript(self):
        node_binary = shutil.which("node")
        if node_binary is None:
            self.skipTest("Node.js is not installed, so JavaScript syntax cannot be checked")
        for name, node in self.nodes.items():
            if node["type"] != "n8n-nodes-base.code":
                continue
            # The Code node runs the script inside an async function, so wrap it the same way.
            wrapped = "(async () => {\n" + node["parameters"]["jsCode"] + "\n})();"
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as handle:
                handle.write(wrapped)
                path = handle.name
            result = subprocess.run([node_binary, "--check", path], capture_output=True, text=True)
            Path(path).unlink(missing_ok=True)
            self.assertEqual(result.returncode, 0, f"{name} has a syntax error:\n{result.stderr}")


if __name__ == "__main__":
    unittest.main()
