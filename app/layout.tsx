import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
export const metadata: Metadata = { title: "NineForge", description: "Prove physical AI before it moves." };
export default function RootLayout({ children }: { children: ReactNode }) { return (<html lang="en"><body>{children}</body></html>); }