"""Seed a demo account with realistic Colorado projects. Idempotent: re-running updates nothing that exists.

    cd apps/api && .venv/bin/python -m scripts.seed_demo

Login: demo@hvacstudio.dev / demo-password-123
"""

from __future__ import annotations

import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models import (  # noqa: E402
    Customer,
    Organization,
    OrganizationMembership,
    Project,
    ProjectStatus,
    ProjectType,
    Role,
    User,
    WorkflowStage,
    utcnow,
)
from app.services.buildings import create_building, load_sample_model  # noqa: E402

DEMO_EMAIL = "demo@hvacstudio.dev"
DEMO_PASSWORD = "demo-password-123"
DEMO_NAME = "Dana Whitfield"
ORG_NAME = "Front Range Heating & Air"

# (project name, address, type, status, stage, customer, days ago updated, use sample fixture)
PROJECTS = [
    (
        "Hendricks Residence — Furnace & AC Replacement",
        "2417 Mapleton Ave, Boulder, CO 80304",
        ProjectType.replacement,
        ProjectStatus.in_progress,
        WorkflowStage.building,
        ("Laura Hendricks", "laura.hendricks@example.com", "303-555-0142"),
        0,
        True,
    ),
    (
        "Alvarez New Build — Lot 14 Prairie Ridge",
        "14 Prairie Ridge Ct, Erie, CO 80516",
        ProjectType.new_construction,
        ProjectStatus.awaiting_information,
        WorkflowStage.building,
        ("Miguel Alvarez", "m.alvarez@example.com", "720-555-0188"),
        2,
        False,
    ),
    (
        "Okafor Basement Finish",
        "981 S Garfield St, Denver, CO 80209",
        ProjectType.remodel,
        ProjectStatus.ready_for_review,
        WorkflowStage.loads,
        ("Chidi Okafor", "chidi.okafor@example.com", "303-555-0117"),
        4,
        False,
    ),
    (
        "Lindqvist Primary Suite Addition",
        "3302 Wild Plum Dr, Fort Collins, CO 80526",
        ProjectType.addition,
        ProjectStatus.draft,
        WorkflowStage.building,
        ("Erik Lindqvist", "erik.l@example.com", "970-555-0163"),
        6,
        False,
    ),
    (
        "Pine Ridge Duplex — Heat Pump Conversion",
        "1540 Pine Ridge Rd, Golden, CO 80401",
        ProjectType.replacement,
        ProjectStatus.in_progress,
        WorkflowStage.equipment,
        ("Pine Ridge Property Mgmt", "service@pineridgepm.example.com", "303-555-0199"),
        9,
        False,
    ),
    (
        "Nakamura Mountain Home — Radiant + Mini-Split",
        "77 Aspen Glen Rd, Evergreen, CO 80439",
        ProjectType.other,
        ProjectStatus.completed,
        WorkflowStage.done,
        ("Kenji & Mari Nakamura", "nakamura.home@example.com", "303-555-0155"),
        21,
        False,
    ),
]


def seed() -> None:
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(func.lower(User.email) == DEMO_EMAIL))
        if user is None:
            user = User(name=DEMO_NAME, email=DEMO_EMAIL, password_hash=hash_password(DEMO_PASSWORD))
            db.add(user)
            db.flush()
            print(f"created user {DEMO_EMAIL}")
        else:
            print(f"user {DEMO_EMAIL} exists")

        org = db.scalar(
            select(Organization)
            .join(OrganizationMembership, OrganizationMembership.organization_id == Organization.id)
            .where(OrganizationMembership.user_id == user.id, Organization.name == ORG_NAME)
        )
        if org is None:
            org = Organization(name=ORG_NAME, subscription_plan="pro")
            db.add(org)
            db.flush()
            db.add(OrganizationMembership(organization_id=org.id, user_id=user.id, role=Role.owner))
            print(f"created organization {ORG_NAME!r}")

        sample = load_sample_model()
        if sample is None:
            print("sample-house fixture not found or invalid; sample project gets an empty building")
        now = utcnow()
        for name, address, ptype, status, stage, (cname, cemail, cphone), days_ago, use_sample in PROJECTS:
            exists = db.scalar(select(Project.id).where(Project.organization_id == org.id, Project.name == name))
            if exists:
                continue
            customer = db.scalar(select(Customer).where(Customer.organization_id == org.id, Customer.name == cname))
            if customer is None:
                customer = Customer(organization_id=org.id, name=cname, email=cemail, phone=cphone, address=address)
                db.add(customer)
                db.flush()
            ts = now - timedelta(days=days_ago, hours=days_ago * 3)
            p = Project(
                organization_id=org.id,
                customer_id=customer.id,
                name=name,
                address=address,
                project_type=ptype,
                status=status,
                workflow_stage=stage,
                assigned_to_user_id=user.id,
                created_by=user.id,
                created_at=ts - timedelta(days=3),
                updated_at=ts,
            )
            db.add(p)
            db.flush()
            model = sample if (use_sample and sample is not None) else None
            create_building(db, p, user.id, model, note="Seeded from sample" if model else "Created")
            print(f"created project {name!r}{' (sample house)' if model else ''}")
        db.commit()
        print(f"\nLogin: {DEMO_EMAIL} / {DEMO_PASSWORD}   X-Organization-Id: {org.id}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
