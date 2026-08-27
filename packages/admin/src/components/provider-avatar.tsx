import { Avatar, AvatarFallback, AvatarImage } from "@buildingai/ui/components/ui/avatar";
import { Brain } from "lucide-react";

import { ProviderIcon, providerIconsMap } from "@client/components/provider-icons";

type ProviderAvatarProps = {
  provider: string;
  iconUrl?: string;
  name: string;
  size?: "sm" | "md";
  className?: string;
  children?: React.ReactNode;
};

/**
 * Reusable provider avatar component
 */
export const ProviderAvatar = ({
  provider,
  iconUrl,
  name,
  size = "md",
  className = "",
  children,
}: ProviderAvatarProps) => {
  const sizeClasses = size === "sm" ? "size-8" : "size-12";
  const iconSizeClasses = size === "sm" ? "size-6" : "size-8";

  return (
    <Avatar
      className={`center bg-muted relative ${sizeClasses} rounded-lg after:rounded-lg ${className}`}
    >
      <AvatarImage src={iconUrl} alt={name} className={`${iconSizeClasses} rounded-lg`} />
      <AvatarFallback className={`${sizeClasses} rounded-lg`}>
        {Object.keys(providerIconsMap).includes(provider) ? (
          <ProviderIcon className={iconSizeClasses} provider={provider} />
        ) : (
          <Brain className={iconSizeClasses} />
        )}
      </AvatarFallback>
      {children}
    </Avatar>
  );
};
