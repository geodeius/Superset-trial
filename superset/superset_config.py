"""Local development configuration. Do not deploy this sample publicly."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL = ROOT / '.local'
with (LOCAL / 'secrets.json').open() as f:
    secrets = json.load(f)
SECRET_KEY = secrets['secretKey']
SQLALCHEMY_DATABASE_URI = f"sqlite:///{LOCAL / 'metadata.db'}?check_same_thread=false"
FEATURE_FLAGS = {'EMBEDDED_SUPERSET': True}
GUEST_TOKEN_JWT_SECRET = secrets['guestKey']
GUEST_TOKEN_JWT_AUDIENCE = 'folio-local'
GUEST_ROLE_NAME = 'EmbeddedGuest'
GUEST_TOKEN_JWT_EXP_SECONDS = 300
APP_NAME = 'Folio Analytics'
WTF_CSRF_ENABLED = True
SESSION_COOKIE_SAMESITE = 'Lax'
# Preserve Superset's security policy and allow only the local portal to frame it.
from superset.config import TALISMAN_CONFIG as DEFAULT_TALISMAN
import copy
TALISMAN_CONFIG = copy.deepcopy(DEFAULT_TALISMAN)
TALISMAN_CONFIG['force_https'] = False
TALISMAN_CONFIG['frame_options'] = None
TALISMAN_CONFIG['content_security_policy']['frame-ancestors'] = ["'self'", 'http://localhost:3017']
# SQLite is deliberately limited to the generated local sample data.
PREVENT_UNSAFE_DB_CONNECTIONS = False
