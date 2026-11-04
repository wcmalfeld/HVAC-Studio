import {
  Box,
  Calculator,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Library,
  Receipt,
  Settings,
  Wind,
  Fan,
  Info,
  type LucideIcon,
} from "lucide-react";

export interface ProjectModule {
  slug: string; // "" for overview
  label: string;
  icon: LucideIcon;
  phase?: number;
  blurb?: string;
  bullets?: string[];
}

export const GLOBAL_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/library", label: "Equipment library", icon: Library },
  { href: "/settings", label: "Company settings", icon: Settings },
] as const;

export const PROJECT_MODULES: ProjectModule[] = [
  { slug: "", label: "Overview", icon: Info },
  { slug: "studio", label: "Building Studio", icon: Box },
  {
    slug: "loads",
    label: "Load Analysis",
    icon: Calculator,
    phase: 2,
    blurb: "Room-by-room heating and cooling loads computed from the building model you draw in Building Studio.",
    bullets: [
      "Design conditions from the project location's weather data",
      "Conduction, infiltration and solar gains traced back to each wall, window and room",
      "Missing inputs flagged before anything is calculated",
      "Saved calculation snapshots you can compare over time",
      "Results labeled preliminary until independently reviewed",
    ],
  },
  {
    slug: "equipment",
    label: "Equipment",
    icon: Fan,
    phase: 3,
    blurb: "Match furnaces, heat pumps and air handlers to this project's loads at its real operating conditions.",
    bullets: [
      "Filter your equipment library by capacity, efficiency and fuel",
      "Side-by-side comparison of up to four systems",
      "Capacity checked at design temperatures, not just nameplate",
      "Incomplete manufacturer data is flagged, never assumed",
    ],
  },
  {
    slug: "ducts",
    label: "Duct Designer",
    icon: Wind,
    phase: 4,
    blurb: "Lay out supply and return runs over the floor plan and size them against the room airflow each space needs.",
    bullets: [
      "Trunks, branches, fittings and registers drawn on the plan",
      "Disconnected components caught as you draw",
      "Duct sizes, velocities and pressure losses shown on every run",
      "Suggested layouts you can accept or edit",
    ],
  },
  {
    slug: "proposals",
    label: "Estimates & Proposals",
    icon: Receipt,
    phase: 5,
    blurb: "Turn the design into a priced estimate and a customer-ready proposal with good / better / best options.",
    bullets: [
      "Parts takeoff generated from the duct design",
      "Labor, markup and tax rules from your company settings",
      "Branded proposals your customer can review online",
    ],
  },
  {
    slug: "reports",
    label: "Reports",
    icon: FileText,
    phase: 6,
    blurb: "Professional PDF reports of the building, loads, equipment and duct design for permits and records.",
    bullets: [
      "Room-by-room load and airflow tables",
      "Floor plans and duct layouts at a printable scale",
      "Every report tied to the calculation snapshot it came from",
    ],
  },
];

export function moduleBySlug(slug: string) {
  return PROJECT_MODULES.find((m) => m.slug === slug);
}
