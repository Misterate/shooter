"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navigation() {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Dashboard" },
    { href: "/settings", label: "Axes" },
  ];

  return (
    <nav className="border-b border-neutral-800 mb-8">
      <div className="max-w-2xl mx-auto px-4 flex items-center justify-between h-14">
        <span className="text-sm font-medium text-neutral-400 tracking-wide uppercase">
          Worth Tracker
        </span>
        <div className="flex gap-6">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`text-sm transition-colors ${
                pathname === href
                  ? "text-neutral-100"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
