import { Tabs, TabsList, TabsTrigger } from "@buildingai/ui/components/ui/tabs";
import { useMemo, useState } from "react";

import { PageContainer } from "@/layouts/console/_components/page-container";

import AliyunSms from "./_components/aliyunSms.tsx";
import TencentSms from "./_components/tencentSms.tsx";

const NoticeSmsPage = () => {
  const tabs = useMemo(
    () => [
      { name: "aliyun", label: "阿里云" },
      { name: "tencent", label: "腾讯云" },
    ],
    [],
  );

  const [activeTab, setActiveTab] = useState("aliyun");

  return (
    <PageContainer>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.name} value={tab.name}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="max-w-full md:max-w-md">
          {activeTab === "aliyun" ? <AliyunSms key="aliyun" /> : <TencentSms key="tencent" />}
        </div>
      </Tabs>
    </PageContainer>
  );
};

export default NoticeSmsPage;
