import json


def test_speech_config_disabled_by_default(admin_client):
    # No AZURE_SPEECH_* in the test env → browser fallback.
    assert admin_client.get("/api/speech/config").json() == {"enabled": False}


def test_speech_token_503_when_unconfigured(admin_client):
    assert admin_client.get("/api/speech/token").status_code == 503


def test_pronunciation_flows_into_scoring(admin_client):
    cid = admin_client.post("/api/conversations", json={"persona_key": "teacher"}).json()["conversation"]["id"]

    score = None
    with admin_client.stream(
        "POST", f"/api/conversations/{cid}/turns",
        json={"text": "नमस्ते, मैं अच्छा बोल रहा हूँ।", "pronunciation": 90},
    ) as resp:
        assert resp.status_code == 200
        for line in resp.iter_lines():
            if line and line.startswith("data: "):
                evt = json.loads(line[6:])
                if evt["type"] == "score":
                    score = evt
    assert score is not None
    assert score["turn"]["pronunciation"] == 90

    # assessment carries the averaged pronunciation
    a = admin_client.post(f"/api/conversations/{cid}/assessment").json()
    assert a["pronunciation"] == 90
