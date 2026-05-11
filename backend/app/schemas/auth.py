"""Pydantic schemas for authentication endpoints."""

from pydantic import BaseModel, EmailStr

from db.models.profile import AppRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    user_id: str
    email: str
    role: AppRole
    full_name: str
    initials: str
    avatar_url: str | None = None


class SessionResponse(BaseModel):
    authenticated: bool
    user: AuthResponse