import type { Metadata } from "next";
import { GlobalComingSoon } from "@/components/app/coming-soon";

export const metadata: Metadata = { title: "Equipment library" };

export default function Page() {
  return (
    <GlobalComingSoon
      title="Equipment library"
      phase={3}
      blurb="Your company's catalog of furnaces, heat pumps, air conditioners and air handlers, with the performance data selection relies on."
      bullets={[
        "Import manufacturer data from spreadsheets",
        "Search and filter by capacity, efficiency, fuel and brand",
        "Expanded performance tables, not just nameplate ratings",
        "Incomplete or inconsistent records flagged before they can be selected",
      ]}
    />
  );
}
