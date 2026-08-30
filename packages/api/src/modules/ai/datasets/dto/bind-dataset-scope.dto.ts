import { IsIn, IsOptional, IsUUID } from "class-validator";

/** 管理端绑定知识库 scope（T4.3 部门知识库） */
export class BindDatasetScopeDto {
    @IsIn(["department", "org", "none"], { message: "scopeType 仅支持 department | org | none" })
    scopeType: "department" | "org" | "none";

    @IsOptional()
    @IsUUID()
    departmentId?: string;
}
