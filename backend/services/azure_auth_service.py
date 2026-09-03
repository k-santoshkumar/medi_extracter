import os
from typing import Any

import jwt
from jwt import PyJWKClient


def validate_access_token(token: str) -> dict[str, Any]:
    tenant_id = os.getenv("AZURE_TENANT_ID")
    audience = os.getenv("AZURE_API_AUDIENCE") or os.getenv("AZURE_CLIENT_ID")
    if not tenant_id or not audience:
        raise ValueError("Azure identity configuration is incomplete")

    issuer = f"https://login.microsoftonline.com/{tenant_id}/v2.0"
    jwks_client = PyJWKClient(
        f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys"
    )
    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=audience,
            issuer=issuer,
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise ValueError("Invalid access token") from exc