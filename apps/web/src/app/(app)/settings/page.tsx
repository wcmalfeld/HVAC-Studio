import type { Metadata } from "next";
import { SettingsView } from "./settings";

export const metadata: Metadata = { title: "Company settings" };

export default function Page() {
  return <SettingsView />;
}
