import { PageContainer } from "@/layouts/console/_components/page-container";

import AiSecretTemplateManage from "./_components/secret-template-manage";

const AiSecretIndexPage = () => {
  return (
    <PageContainer className="secret-index-page">
      <AiSecretTemplateManage />
    </PageContainer>
  );
};

export default AiSecretIndexPage;
