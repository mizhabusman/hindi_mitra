from tests.conftest import ADMIN_PASS, ADMIN_USER


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_requires_auth(client):
    assert client.get("/api/personas").status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_bad_login(client):
    assert client.post("/api/auth/login", json={"username": "x", "password": "y"}).status_code == 401


def test_login_logout_flow(client):
    r = client.post("/api/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200 and r.json()["role"] == "admin"
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_personas_seeded_and_prompt_hidden(admin_client):
    personas = admin_client.get("/api/personas").json()
    assert len(personas) == 8
    # "Friend" is seeded first (lowest sort_order) → the default selection.
    assert personas[0]["key"] == "friend"
    assert all("system_prompt" not in p for p in personas)
