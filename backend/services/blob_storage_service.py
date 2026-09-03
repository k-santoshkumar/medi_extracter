import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from azure.storage.blob import BlobSasPermissions, BlobServiceClient, generate_blob_sas


def get_blob_container_name() -> str:
    return os.getenv("AZURE_STORAGE_CONTAINER_NAME", "medical-records")


def get_blob_service_client() -> Optional[BlobServiceClient]:
    connection_string = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not connection_string:
        return None
    return BlobServiceClient.from_connection_string(connection_string)


def ensure_blob_container() -> Optional[str]:
    client = get_blob_service_client()
    if client is None:
        return None

    container_name = get_blob_container_name()
    container_client = client.get_container_client(container_name)
    try:
        container_client.create_container()
    except Exception:
        pass
    return container_name


def upload_file_to_blob(file_path: str, original_filename: str, user_id: str) -> str:
    client = get_blob_service_client()
    if client is None:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING is not configured.")

    container_name = ensure_blob_container()
    if not container_name:
        raise RuntimeError("Azure Blob container could not be initialized.")

    safe_user_id = str(user_id).replace("/", "_").replace("\\", "_").replace(" ", "_")
    safe_name = Path(original_filename).name
    blob_name = f"users/{safe_user_id}/{uuid.uuid4()}_{safe_name}"

    with open(file_path, "rb") as source_file:
        blob_client = client.get_blob_client(container=container_name, blob=blob_name)
        blob_client.upload_blob(source_file.read(), overwrite=True)

    return blob_name


def get_blob_endpoint() -> Optional[str]:
    connection_string = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not connection_string:
        return None

    parts = {}
    for part in connection_string.split(";"):
        if "=" in part:
            key, value = part.split("=", 1)
            parts[key.lower()] = value

    if parts.get("blobendpoint"):
        return parts["blobendpoint"].rstrip("/")

    account_name = parts.get("accountname")
    if account_name:
        return f"https://{account_name}.blob.core.windows.net"
    return None


def build_blob_download_url(blob_name: str, expiry_hours: int = 24) -> Optional[str]:
    if not blob_name:
        return None

    connection_string = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not connection_string:
        return None

    parts = {}
    for part in connection_string.split(";"):
        if "=" in part:
            key, value = part.split("=", 1)
            parts[key.lower()] = value

    account_name = parts.get("accountname")
    account_key = parts.get("accountkey")
    if not account_name or not account_key:
        return None

    sas_token = generate_blob_sas(
        account_name=account_name,
        container_name=get_blob_container_name(),
        blob_name=blob_name,
        account_key=account_key,
        permission=BlobSasPermissions(read=True),
        expiry=datetime.now(timezone.utc) + timedelta(hours=expiry_hours),
    )
    base_url = get_blob_endpoint() or f"https://{account_name}.blob.core.windows.net"
    return f"{base_url.rstrip('/')}/{get_blob_container_name()}/{blob_name}?{sas_token}"


def download_file_from_blob(blob_name: str) -> bytes:
    client = get_blob_service_client()
    if client is None:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING is not configured.")

    container_name = ensure_blob_container()
    if not container_name:
        raise RuntimeError("Azure Blob container could not be initialized.")

    blob_client = client.get_blob_client(container=container_name, blob=blob_name)
    return blob_client.download_blob().readall()
