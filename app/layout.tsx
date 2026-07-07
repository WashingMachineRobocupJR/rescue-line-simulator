import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rescue Line Simulator",
  description:
    "Free browser simulator for RoboCup Junior Rescue Line: build courses, program a virtual robot in JavaScript, score your runs. No field, no robot, no budget required.",
  metadataBase: new URL("https://sim.washingmachine.click"),
  openGraph: {
    title: "Rescue Line Simulator",
    description:
      "Build Rescue Line courses and program a virtual robot in your browser. Free and open source.",
    siteName: "Rescue Line Simulator",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
