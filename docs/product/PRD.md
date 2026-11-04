# HVAC STUDIO
## Complete Product Requirements & Technical Implementation Specification

**Version:** 2.0  
**Product Category:** Residential HVAC Design SaaS  
**Primary Customer:** Residential HVAC Contractors  
**Development Environment:** Claude Code  
**Architecture:** Cloud-native, modular, multi-tenant application  
**Initial Market:** United States  
**Product Scope:** Complete residential HVAC design platform

---

# PART I — PRODUCT VISION

## 1. Executive Summary

HVAC Studio is a next-generation residential HVAC engineering and contractor productivity platform.

The goal is to build a substantially better alternative to traditional HVAC design software, including Wrightsoft Right-Suite Universal.

HVAC Studio will combine:

1. Building modeling and floor-plan design.
2. Residential heating and cooling load calculations.
3. HVAC equipment selection.
4. Automated duct design.
5. Engineering analysis and validation.
6. AI-powered drawing interpretation.
7. Automated design recommendations.
8. Project estimating and proposals.
9. Professional PDF documentation.
10. Cloud-based project management and collaboration.

The application should be powerful enough for experienced HVAC professionals while being significantly easier to learn and operate.

### Core product philosophy

**Make complex HVAC engineering feel simple without making the engineering itself simplistic.**

The application should eliminate unnecessary data entry, repetitive calculations, disconnected modules, and outdated workflows.

A user should be able to take a project from an initial customer conversation to a complete, professionally documented HVAC design in one application.

## 2. Product Goals

### Primary goals

- Build a complete residential HVAC design workflow.
- Make building modeling fast and intuitive.
- Provide accurate, independently verifiable engineering calculations.
- Automate repetitive contractor workflows.
- Make equipment selection easier and more transparent.
- Generate intelligent duct design recommendations.
- Create professional documentation automatically.
- Work reliably on Mac and Windows through a browser.
- Support multiple contractors and organizations.
- Establish an architecture capable of future expansion.

### Competitive advantages

The application must compete on all three dimensions:

**Engineering**
- Accurate calculations.
- Transparent assumptions.
- Advanced configuration.
- Real equipment performance data.
- Engineering validation.

**Automation**
- AI-assisted drawing interpretation.
- Automatic room detection.
- Automatic load recalculation.
- Suggested equipment configurations.
- Suggested duct layouts.
- Automatic reporting.

**User experience**
- Modern interface.
- Visual-first building modeling.
- Contextual editing.
- Intuitive navigation.
- Minimal unnecessary forms.
- Fast project creation.

## 3. Primary User Personas

### Persona A: HVAC Contractor / Business Owner

Needs:
- Quickly evaluate residential projects.
- Produce professional proposals.
- Size equipment appropriately.
- Reduce design time.
- Maintain project records.
- Share results with customers and employees.

### Persona B: HVAC Designer / Technical Employee

Needs:
- Detailed building models.
- Room-by-room calculations.
- Equipment performance analysis.
- Duct sizing.
- Engineering transparency.
- Advanced technical controls.

### Persona C: HVAC Sales Representative

Needs:
- Quickly create customer projects.
- Import building plans.
- Understand system requirements.
- Compare equipment.
- Generate professional proposals.
- Explain recommendations to customers.

The application must accommodate all three without creating three separate products.

---

# PART II — APPLICATION STRUCTURE

## 4. Primary Navigation

Build the application around the following navigation structure:

1. Dashboard
2. Projects
3. Building Studio
4. Load Analysis
5. Equipment
6. Duct Designer
7. Estimates & Proposals
8. Reports
9. Equipment Library
10. Company Settings

Navigation should be contextual.

Users working inside a project should have access to its associated modules without repeatedly returning to the main dashboard.

## 5. Dashboard

Create a premium SaaS dashboard.

### Dashboard components

- Welcome section.
- Create New Project button.
- Recent Projects.
- Active Projects.
- Completed Projects.
- Projects Requiring Attention.
- Recently Generated Reports.
- Project Search.
- Project Filters.

### Project cards

Each project card should display:

- Project name.
- Customer.
- Building address.
- Project type.
- Last modified.
- Current workflow stage.
- Assigned team member.
- Project status.

### Project statuses

- Draft.
- In Progress.
- Awaiting Information.
- Ready for Review.
- Completed.
- Archived.

### Dashboard functionality

- Create project.
- Duplicate project.
- Archive project.
- Search projects.
- Filter projects.
- Open project.
- Delete project with confirmation.

---

# PART III — BUILDING STUDIO

## 6. Core Building Editor

Building Studio is the most important user-facing module.

It must be a highly interactive 2D drawing application.

Use a large central canvas with contextual side panels.

### Interface layout

**Left sidebar**
- Building components.
- Layers.
- Floors.
- Rooms.
- Drawing tools.

**Center**
- Interactive floor-plan canvas.

**Right sidebar**
- Selected object properties.
- Room properties.
- Construction details.
- Engineering information.

**Top toolbar**
- Project navigation.
- Undo.
- Redo.
- Save status.
- Zoom.
- Pan.
- Selection tools.
- Measurement tools.
- View controls.
- Export.

**Bottom panel**
- Calculation status.
- Design warnings.
- Validation issues.
- Object measurements.

Users must be able to collapse both sidebars.

### 6.1 Canvas functionality

Implement:

- Infinite or large drawing workspace.
- Pan.
- Zoom.
- Grid.
- Snap to grid.
- Snap to objects.
- Dimension annotations.
- Object selection.
- Multi-selection.
- Object movement.
- Object rotation.
- Copy and paste.
- Delete.
- Undo and redo.
- Keyboard shortcuts.
- Layer visibility.
- Multiple floors.
- Zoom to fit.
- Measurement display.

The canvas must remain responsive with hundreds of building objects.

### 6.2 Building geometry

Represent building geometry using a consistent coordinate system.

Requirements:

- Store canonical dimensions in a defined internal unit system.
- Support imperial and metric display.
- Preserve dimensional precision.
- Use vector-based geometry where possible.
- Separate visual rendering from engineering geometry.
- Maintain stable object identifiers.
- Validate geometry before calculations.

Never derive engineering dimensions from screen pixels.

### 6.3 Building components

Create reusable component types:

- Exterior walls.
- Interior walls.
- Windows.
- Doors.
- Floors.
- Ceilings.
- Roofs.
- Attics.
- Crawlspaces.
- Foundations.
- Garages.
- Skylights.
- Room boundaries.

Every component must have an editable property panel.

### 6.4 Wall properties

- Length.
- Height.
- Thickness.
- Construction type.
- Insulation.
- R-value.
- U-factor.
- Exterior/interior designation.
- Adjacent space.
- Orientation.
- Thermal characteristics.

### 6.5 Window properties

- Width.
- Height.
- Area.
- Orientation.
- Window type.
- U-factor.
- Solar heat gain coefficient.
- Frame material.
- Number of panes.
- Shading characteristics.

### 6.6 Door properties

- Width.
- Height.
- Construction.
- U-factor.
- Exterior/interior designation.

### 6.7 Floor and ceiling properties

- Construction type.
- Insulation.
- R-value.
- Adjacent space.
- Exposure.
- Area.

### 6.8 Room management

Every room must be an independently identifiable entity.

Properties:

- Room name.
- Room type.
- Floor.
- Length.
- Width.
- Ceiling height.
- Area.
- Volume.
- Exterior wall exposure.
- Window area.
- Door area.
- Insulation characteristics.
- Occupancy.
- Internal loads.
- Assigned HVAC zone.

Automatically calculate area and volume from validated geometry.

Users should be able to click any room to inspect its characteristics.

### 6.9 Floor management

Support:

- Multiple floors.
- Floor elevations.
- Floor-to-floor heights.
- Room assignments.
- Floor-specific drawing layers.
- Floor-specific load summaries.

---

# PART IV — DRAWING IMPORT & AI

## 7. Floor Plan Import

Support importing:

- PDF.
- PNG.
- JPG.
- DXF.
- DWG where technically supported through a licensed or compatible conversion solution.

### Import workflow

1. Upload drawing.
2. Preview document.
3. Select drawing page.
4. Calibrate scale.
5. Position drawing on canvas.
6. Lock background layer.
7. Trace or detect building geometry.
8. Review detected components.
9. Approve imported building model.

### Scale calibration

Allow users to identify a known dimension and calibrate the drawing.

The application should clearly display calibration accuracy and warn users if the source image is insufficiently clear.

## 8. AI Floor Plan Interpretation

Implement an AI-assisted drawing interpretation service.

### AI detection capabilities

Attempt to identify:

- Exterior walls.
- Interior walls.
- Room boundaries.
- Room names.
- Dimensions.
- Windows.
- Doors.
- Building orientation.
- Floor levels.

### AI processing workflow

1. User uploads a drawing.
2. Backend stores the original document.
3. Drawing processing service extracts image and vector information.
4. Vision model identifies candidate objects.
5. Model returns structured JSON.
6. Backend validates the response against the building schema.
7. Application displays proposed building geometry.
8. User reviews and approves changes.
9. Approved objects become part of the building model.

### Important requirements

- AI must never silently approve inferred dimensions.
- Every inferred measurement must have a confidence score.
- Distinguish measured, user-entered, and inferred values.
- Provide a review interface for uncertain objects.
- Preserve the original document.
- Allow individual object corrections.

AI should return structured data, not free-form instructions that directly modify the database.

---

# PART V — ENGINEERING CALCULATION ENGINE

## 9. Engineering Architecture

Create a completely independent engineering calculation package.

Suggested package:

`packages/engineering-engine/`

The calculation engine must be independent of:

- React.
- UI components.
- AI providers.
- Browser state.
- Database-specific logic.

It should accept validated engineering inputs and return deterministic outputs.

### Core engineering modules

- Weather data.
- Building envelope.
- Room loads.
- Whole-building loads.
- Equipment selection.
- Airflow calculations.
- Duct sizing.
- Static pressure.
- System validation.

### Engineering principles

1. Every calculation must be reproducible.
2. Every calculation must identify its method and version.
3. Every output must identify its input dependencies.
4. Missing inputs must be explicitly identified.
5. Unsupported configurations must produce warnings.
6. No AI-generated engineering values.
7. No silent substitution of missing inputs.
8. Engineering regression tests are mandatory.

## 10. Manual J — Heating and Cooling Loads

Implement a validated residential load calculation workflow.

### Input categories

**Building envelope**
- Walls.
- Roof.
- Ceilings.
- Floors.
- Windows.
- Doors.
- Insulation.
- Thermal characteristics.

**Building geometry**
- Room dimensions.
- Building orientation.
- Floor levels.
- Exterior exposures.
- Surface areas.

**Occupancy and internal loads**
- Occupants.
- Lighting.
- Appliances.
- Internal sensible and latent loads.

**Environmental conditions**
- Location.
- Elevation.
- Outdoor design temperatures.
- Indoor design temperatures.
- Humidity.
- Solar conditions.

**Air exchange**
- Infiltration.
- Ventilation.
- Exhaust.
- Outdoor air requirements.

### Calculation outputs

- Whole-building heating load.
- Whole-building cooling load.
- Sensible cooling load.
- Latent cooling load.
- Room-by-room loads.
- Zone-by-zone loads.
- Design conditions.
- Input assumptions.
- Calculation warnings.

### Calculation result interface

Create a visual load analysis dashboard.

Include:
- Heating load chart.
- Cooling load chart.
- Room comparison.
- Heat loss breakdown.
- Heat gain breakdown.
- Envelope performance.
- Room load table.
- Input completeness indicator.

Clicking a room in the results should select the corresponding room in Building Studio.

### Engineering validation

Build a test suite containing:

- Simple rectangular building cases.
- Multi-room buildings.
- Multi-floor buildings.
- Different climate conditions.
- Different window configurations.
- Different insulation configurations.
- High-infiltration cases.
- Complex building geometry.

Test against independently verified reference calculations and properly licensed engineering test cases.

Do not claim Manual J compliance until the implementation has passed the applicable review and approval process.

---

# PART VI — EQUIPMENT SELECTION

## 11. Equipment Database

Build a normalized equipment catalog.

Supported equipment categories:

- Air conditioners.
- Heat pumps.
- Furnaces.
- Air handlers.
- Mini-splits.
- Boilers.
- Other residential heating and cooling equipment.

### Equipment fields

- Manufacturer.
- Model number.
- Equipment category.
- Nominal capacity.
- Heating capacity.
- Cooling capacity.
- Efficiency ratings.
- Operating temperature ranges.
- Airflow requirements.
- Electrical specifications.
- Performance data.
- Documentation links.
- Data source.
- Data revision date.

### Equipment data ingestion

Create an administrative equipment-import system.

Support:

- CSV import.
- Structured JSON import.
- Manual entry.
- Manufacturer documentation attachments.
- Data validation.
- Duplicate detection.
- Revision history.

Do not scrape manufacturer catalogs in violation of their terms.

Design the catalog to support authorized manufacturer integrations later.

## 12. Equipment Selection Engine

Implement an equipment matching workflow.

### User workflow

1. Complete building model.
2. Complete heating and cooling calculations.
3. Open Equipment Selection.
4. Review system requirements.
5. Filter available equipment.
6. Compare candidate systems.
7. Select equipment.
8. Review performance.
9. Approve system configuration.

### Selection criteria

- Calculated heating requirements.
- Calculated cooling requirements.
- Sensible capacity.
- Latent capacity.
- Outdoor design conditions.
- Indoor design conditions.
- Manufacturer performance tables.
- Operating limitations.
- Airflow requirements.

### Comparison interface

Display:

- Equipment model.
- Manufacturer.
- Heating performance.
- Cooling performance.
- Efficiency.
- Capacity at relevant conditions.
- Suitability warnings.

Use Manual S principles and applicable manufacturer data for equipment selection.

Nominal tonnage alone must never determine whether equipment is appropriate.

---

# PART VII — DUCT DESIGNER

## 13. Visual Duct Design

Create a dedicated Duct Designer interface.

The designer should share the building geometry with Building Studio.

### Components

- Supply registers.
- Return registers.
- Supply trunks.
- Return trunks.
- Branch ducts.
- Elbows.
- Transitions.
- Plenums.
- Dampers.
- Air handlers.
- Other supported fittings.

### Visual requirements

- Distinguish supply and return.
- Show airflow direction.
- Show duct dimensions.
- Display airflow values.
- Display fitting information.
- Support dragging and repositioning.
- Support connection snapping.
- Detect disconnected duct segments.
- Detect invalid geometry.
- Support multiple HVAC systems.

## 14. Duct Calculation Engine

Implement the engineering foundation for residential duct sizing.

Inputs:

- Required room airflow.
- Equipment airflow.
- Available static pressure.
- Duct material.
- Duct shape.
- Duct dimensions.
- Duct length.
- Fitting type.
- Fitting equivalent length.
- Filter and accessory pressure losses.
- Supply and return configurations.

Outputs:

- Duct dimensions.
- Air velocity.
- Friction rate.
- Pressure loss.
- Equivalent length.
- Total effective length.
- Estimated static pressure.
- Airflow distribution.
- Design warnings.

Implement a deterministic calculation engine using licensed or otherwise lawfully obtained engineering references and verified data.

## 15. Automated Duct Design

Create a feature called:

**Generate Suggested Duct Layout**

The application should propose:

- Supply register placement.
- Return register placement.
- Main trunk routes.
- Branch connections.
- Duct dimensions.
- System configuration.

The initial automated routing engine should use deterministic geometry and routing algorithms.

AI may suggest design alternatives, but it must not independently determine engineering dimensions.

### Suggested workflow

1. Select HVAC equipment.
2. Review required system airflow.
3. Review room airflow requirements.
4. Generate proposed layout.
5. Inspect warnings.
6. Modify design.
7. Recalculate.
8. Approve final configuration.

### Optimization objectives

- Minimize unnecessary duct length.
- Avoid unnecessary fittings.
- Reduce excessive pressure loss.
- Maintain valid routing.
- Respect building geometry.
- Avoid physical obstructions where modeled.
- Support practical installation.

Allow manual overrides and clearly identify modified components.

---

# PART VIII — CONTRACTOR WORKFLOWS

## 16. Project Estimating

Introduce an estimating module to make the application more valuable to contractors.

Allow users to create estimates based on:

- Selected HVAC equipment.
- Duct materials.
- Registers.
- Fittings.
- Installation components.
- Labor.
- Additional services.

### Estimate functionality

- Line items.
- Quantities.
- Unit costs.
- Labor costs.
- Markups.
- Discounts.
- Tax configuration.
- Customer pricing.
- Estimate revisions.

Allow companies to create reusable pricing templates.

Clearly distinguish engineering selections from contractor pricing decisions.

## 17. Customer Proposals

Generate polished customer proposals.

Include:

- Company logo.
- Company information.
- Customer details.
- Building details.
- Proposed HVAC system.
- Equipment specifications.
- Project scope.
- Pricing.
- Optional upgrades.
- Warranty information.
- Terms and conditions.
- Approval/signature area.

Allow multiple equipment options in a proposal.

For example:

- Standard system.
- Premium system.
- High-efficiency system.

Allow the contractor to customize all proposal content.

## 18. Parts Takeoff

Create an automatically generated parts list based on the approved design.

Include:

- Equipment.
- Duct materials.
- Duct fittings.
- Registers.
- Grilles.
- Dampers.
- Accessories.
- Other configured components.

Quantities must be derived from the design model where possible.

Allow users to manually adjust quantities and mark items as purchased or installed.

---

# PART IX — AI ENGINEERING ASSISTANT

## 19. Persistent AI Assistant

Create a project-aware AI assistant.

It should be available throughout the application.

### Example prompts

- Explain the heating load of this building.
- Which rooms have the highest cooling loads?
- What information is missing?
- Identify unusual window configurations.
- Compare these equipment options.
- Explain this duct pressure-loss result.
- Identify disconnected duct sections.
- Generate a customer-friendly explanation of this system.
- Summarize the project for my installation team.

### Architecture

AI should interact with the application through controlled backend tools.

Examples:

- get_project_summary
- get_room_data
- get_load_results
- get_equipment_candidates
- get_duct_design
- get_validation_warnings
- generate_customer_summary

AI must not have unrestricted database write access.

### AI response requirements

Every response involving project-specific engineering information must reference the underlying data.

AI should distinguish:

- Verified input.
- User assumption.
- Inferred information.
- Calculated result.
- Engineering recommendation.

All recommendations involving changes to the project require user confirmation.

---

# PART X — REPORTING

## 20. Professional Reporting Engine

Create a reusable document-generation service.

Report types:

- Building information report.
- Load calculation report.
- Room-by-room load report.
- Equipment selection report.
- Duct design report.
- System summary.
- Parts takeoff.
- Contractor proposal.

### PDF functionality

- Professional layouts.
- Company branding.
- Logo upload.
- Custom headers.
- Custom footers.
- Page numbering.
- Project photographs.
- Tables.
- Charts.
- Technical notes.
- Revision information.

Reports must include sufficient input and calculation provenance for technical review.

Do not present preliminary results as validated compliance documents.

---

# PART XI — TECHNICAL ARCHITECTURE

## 21. Recommended Technology Stack

Use a monorepo architecture.

### Frontend

- Next.js.
- React.
- TypeScript.
- Tailwind CSS.
- shadcn/ui or equivalent component system.
- Konva.js or equivalent for the 2D drawing canvas.
- TanStack Query for server state.
- Zustand for appropriate local editor state.
- React Hook Form and Zod for form validation.

### Backend

- Python.
- FastAPI.
- Pydantic.
- SQLAlchemy.
- REST APIs.
- Background workers for long-running tasks.

### Database

- PostgreSQL.
- PostGIS where needed.
- Database migrations.
- Versioned project schemas.

### Infrastructure

- Cloud object storage.
- Redis for caching and job queues.
- Background workers.
- Secure authentication.
- Automated backups.
- Centralized error monitoring.

### Testing

- Vitest.
- Playwright.
- Pytest.
- Engineering regression tests.
- API integration tests.

Claude Code should verify dependency compatibility and use stable supported versions during implementation.

## 22. Monorepo Structure

Create the following starting architecture:

```text
hvac-studio/
│
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── styles/
│   │
│   └── api/
│       ├── app/
│       │   ├── api/
│       │   ├── core/
│       │   ├── models/
│       │   ├── schemas/
│       │   ├── services/
│       │   └── workers/
│       └── tests/
│
├── packages/
│   ├── shared-types/
│   ├── building-geometry/
│   ├── engineering-engine/
│   │   ├── weather/
│   │   ├── envelope/
│   │   ├── load-calculations/
│   │   ├── equipment-selection/
│   │   ├── duct-calculations/
│   │   └── validation/
│   │
│   ├── drawing-engine/
│   ├── report-engine/
│   └── ui/
│
├── infrastructure/
│   ├── docker/
│   ├── database/
│   └── deployment/
│
├── docs/
│   ├── architecture/
│   ├── engineering/
│   ├── api/
│   └── product/
│
├── scripts/
├── tests/
├── docker-compose.yml
├── README.md
└── CLAUDE.md
```

This is the initial architecture, not a requirement to create empty directories for every future module before functionality exists.

## 23. Database Design

Create normalized relational entities.

### Core entities

**User**
- id
- name
- email
- authentication_provider
- created_at

**Organization**
- id
- name
- subscription_plan
- settings
- created_at

**OrganizationMembership**
- id
- organization_id
- user_id
- role

**Customer**
- id
- organization_id
- name
- email
- phone
- address

**Project**
- id
- organization_id
- customer_id
- name
- address
- project_status
- project_type
- created_at
- updated_at

**Building**
- id
- project_id
- geometry_version
- orientation
- building_properties

**Floor**
- id
- building_id
- name
- elevation
- floor_height

**Room**
- id
- floor_id
- name
- geometry
- room_properties

**BuildingComponent**
- id
- building_id
- floor_id
- room_id
- component_type
- geometry
- engineering_properties
- provenance

**HVACSystem**
- id
- project_id
- equipment_id
- system_type
- design_parameters

**CalculationRun**
- id
- project_id
- calculation_type
- method_version
- input_snapshot
- output_snapshot
- validation_status
- created_at

**Equipment**
- id
- manufacturer
- model_number
- category
- specifications
- performance_data
- data_source
- revision_date

**DuctSegment**
- id
- system_id
- geometry
- material
- dimensions
- airflow
- engineering_properties

**Estimate**
- id
- project_id
- status
- subtotal
- total
- created_at

**EstimateLineItem**
- id
- estimate_id
- description
- quantity
- unit_cost
- markup

**Document**
- id
- project_id
- document_type
- storage_location
- revision
- created_at

Use separate project, organization, and user permissions. Every tenant-owned database query must enforce organization boundaries.

Do not store derived engineering values as authoritative inputs. Store calculation runs as versioned snapshots with their input dependencies.

---

# PART XII — API DESIGN

## 24. Core API Endpoints

Create versioned endpoints.

### Authentication and organizations

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
GET    /api/v1/users/me
GET    /api/v1/organizations
POST   /api/v1/organizations
GET    /api/v1/organizations/{id}/members
```

### Projects

```text
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/{id}
PATCH  /api/v1/projects/{id}
DELETE /api/v1/projects/{id}
```

### Building

```text
GET    /api/v1/projects/{id}/building
PUT    /api/v1/projects/{id}/building
POST   /api/v1/projects/{id}/floors
POST   /api/v1/projects/{id}/rooms
PATCH  /api/v1/rooms/{id}
POST   /api/v1/projects/{id}/components
PATCH  /api/v1/components/{id}
DELETE /api/v1/components/{id}
```

### Drawing import

```text
POST   /api/v1/projects/{id}/drawings
GET    /api/v1/drawings/{id}
POST   /api/v1/drawings/{id}/analyze
GET    /api/v1/drawings/{id}/analysis
POST   /api/v1/drawings/{id}/approve
```

### Engineering

```text
POST   /api/v1/projects/{id}/calculations/load
GET    /api/v1/projects/{id}/calculations
GET    /api/v1/calculations/{id}
POST   /api/v1/projects/{id}/equipment/match
POST   /api/v1/projects/{id}/duct-designs
POST   /api/v1/duct-designs/{id}/calculate
POST   /api/v1/duct-designs/{id}/validate
```

### Estimating and documents

```text
POST   /api/v1/projects/{id}/estimates
GET    /api/v1/estimates/{id}
PATCH  /api/v1/estimates/{id}
POST   /api/v1/projects/{id}/proposals
POST   /api/v1/projects/{id}/reports
GET    /api/v1/documents/{id}
```

All endpoints must include authorization, input validation, error handling, and tenant isolation.

Long-running jobs must support status retrieval and safe retries.

---

# PART XIII — PROJECT DATA FLOW

## 25. Centralized Project Data Model

All application modules must share a central project model.

Example workflow:

```text
CUSTOMER
   |
   v
PROJECT
   |
   v
BUILDING MODEL
   |
   +---- FLOOR PLANS
   |
   +---- ROOMS
   |
   +---- WALLS / WINDOWS / DOORS
   |
   +---- BUILDING ENVELOPE
   |
   v
LOAD CALCULATIONS
   |
   v
EQUIPMENT SELECTION
   |
   v
DUCT DESIGN
   |
   v
ESTIMATE / PARTS TAKEOFF
   |
   v
PROPOSAL / REPORT
```

### Dependency management

A change to any engineering input must invalidate the affected downstream results.

Examples:

- Window change: invalidate affected envelope and load calculations.
- Wall insulation change: invalidate affected heating and cooling loads.
- Equipment change: invalidate equipment-dependent airflow and duct calculations.
- Duct dimension change: invalidate relevant pressure and airflow results.
- Room geometry change: invalidate dependent room area, surface areas, and loads.

Do not blindly invalidate the entire project when only a small subset of calculations depends on a change.

Implement a dependency graph.

Every calculation should record:
- Input version.
- Input hash.
- Method version.
- Output version.
- Dependencies.
- Validation status.

This makes results reproducible and allows the application to identify stale calculations.

---

# PART XIV — SECURITY AND RELIABILITY

## 26. Security Requirements

Implement:

- Secure authentication.
- Password hashing where passwords are managed locally.
- Organization-level access control.
- Role-based permissions.
- Secure file uploads.
- Input sanitization.
- API rate limiting.
- Audit logs.
- Encrypted network communication.
- Secure secrets management.
- Protection against cross-tenant data access.

Do not expose API keys in frontend code.

## 27. Reliability Requirements

- Automatic project saving.
- Recovery after browser crashes.
- Version history.
- Database backups.
- Error logging.
- Background task recovery.
- Idempotent calculation jobs.
- File upload validation.
- Database migration testing.

The building editor should not lose work when a user refreshes a page.

Use autosave with clear save-state feedback and conflict handling.

---

# PART XV — DEVELOPMENT ROADMAP

## 28. Implementation Strategy

Build the entire product architecture progressively.

Do not attempt to implement all engineering calculations, AI, and drawing features in one development pass.

Every phase must produce working functionality.

### Phase 0 — Foundation

Build:
- Monorepo.
- Development environment.
- Database.
- Authentication.
- Organizations.
- Project management.
- Shared design system.
- Initial dashboard.
- CI testing.

Acceptance:
- Users can register and log in.
- Organizations can be created.
- Projects can be created and saved.
- Tenant isolation works.
- Application runs locally and deploys to a development environment.

### Phase 1 — Building Studio

Build:
- Drawing canvas.
- Geometry engine.
- Walls.
- Rooms.
- Windows.
- Doors.
- Floors.
- Properties panels.
- Measurements.
- Undo and redo.
- Autosave.
- Drawing import foundation.

Acceptance:
- User can model a multi-room residential building.
- Room areas and volumes calculate correctly.
- Components can be edited.
- Project can be closed and reopened without losing information.
- Geometry tests pass.

### Phase 2 — Load Analysis

Build:
- Building envelope model.
- Weather data integration.
- Environmental design conditions.
- Calculation input validation.
- Load calculation framework.
- Room load interface.
- Building load interface.
- Calculation snapshots.
- Engineering regression tests.

Acceptance:
- User can enter all required engineering inputs.
- Incomplete inputs are clearly identified.
- Calculation outputs are traceable.
- Regression tests pass.
- Results are clearly identified as preliminary until validation is obtained.

### Phase 3 — Equipment Selection

Build:
- Equipment catalog.
- Import tools.
- Search and filtering.
- Performance data.
- Equipment comparison.
- Equipment matching engine.
- Equipment selection workflow.

Acceptance:
- User can import equipment.
- User can compare multiple models.
- Performance is evaluated at applicable operating conditions.
- Invalid or incomplete equipment data is flagged.

### Phase 4 — Duct Designer

Build:
- Visual duct canvas.
- Supply and return components.
- Duct geometry.
- Connection validation.
- Airflow requirements.
- Sizing engine.
- Pressure-loss calculations.
- Automated layout suggestions.

Acceptance:
- User can create a duct design.
- System identifies disconnected components.
- Duct dimensions and calculated values are visible.
- Changes trigger appropriate recalculation.
- Engineering test cases pass.

### Phase 5