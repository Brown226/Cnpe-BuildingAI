"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@buildingai/ui/components/ui/sidebar";
import { Book, type LucideIcon, Send } from "lucide-react";
import * as React from "react";

import { ConsoleLogo } from "./console-logo";
import { NavMain } from "./nav-main";
import { NavSecondary } from "./nav-secondary";
import { NavUser } from "./nav-user";

const navSecondary: {
  title: string;
  url: string;
  icon: LucideIcon;
}[] = [];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <ConsoleLogo />
      </SidebarHeader>
      <SidebarContent className="gap-0">
        <NavMain />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
