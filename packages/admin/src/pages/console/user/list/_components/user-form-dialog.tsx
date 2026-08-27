import { BooleanNumber } from "@buildingai/constants/shared/status-codes.constant";
import {
  type CreateUserDto,
  type Role,
  type UpdateUserDto,
  useAllDepartmentsQuery,
  useCreateUserMutation,
  useRolesQuery,
  useUpdateUserMutation,
  useUserDetailQuery,
} from "@buildingai/services/console";
import { Button } from "@buildingai/ui/components/ui/button";
import { Checkbox } from "@buildingai/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@buildingai/ui/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@buildingai/ui/components/ui/form";
import { ImageUpload } from "@buildingai/ui/components/ui/image-upload";
import { Input } from "@buildingai/ui/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@buildingai/ui/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@buildingai/ui/components/ui/radio-group";
import { ScrollArea } from "@buildingai/ui/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@buildingai/ui/components/ui/select";
import { TimeText } from "@buildingai/ui/components/ui/time-text";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { BalanceAdjustmentDialog } from "./balance-adjustment-dialog";
import { MembershipAdjustmentDialog } from "./membership-adjustment-dialog";

const formSchema = z
  .object({
    username: z
      .string({ message: "用户名必须填写" })
      .min(2, "用户名至少2个字符")
      .max(50, "用户名不能超过50个字符"),
    password: z.string().optional(),
    nickname: z.string().max(50, "昵称不能超过50个字符").optional(),
    email: z.string().email("请输入有效的邮箱地址").optional().or(z.literal("")),
    phone: z.string().max(20, "手机号不能超过20个字符").optional(),
    avatar: z.string().optional(),
    roleId: z.string().optional(),
    status: z.boolean().optional(),
    power: z.number().optional(),
    realName: z.string().max(50, "真实姓名不能超过50个字符").optional(),
    departmentIds: z.array(z.string()).optional(),
  })
  .refine(
    () => {
      // Password is required only for create mode (when there's no existing user)
      return true;
    },
    { message: "密码必须填写", path: ["password"] },
  );

type FormValues = z.infer<typeof formSchema>;

type UserFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string | null;
  onSuccess?: () => void;
};

/**
 * User form dialog component for creating and updating users
 */
export const UserFormDialog = ({ open, onOpenChange, userId, onSuccess }: UserFormDialogProps) => {
  const isEditMode = !!userId;
  const [balanceDialogOpen, setBalanceDialogOpen] = useState(false);
  const [membershipDialogOpen, setMembershipDialogOpen] = useState(false);

  const { data: roles } = useRolesQuery();
  const { data: allDepartments } = useAllDepartmentsQuery();

  const { data: userDetail, refetch: refetchUserDetail } = useUserDetailQuery(userId || "", {
    enabled: isEditMode && open,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema as any),
    defaultValues: {
      username: "",
      password: "",
      nickname: "",
      email: "",
      phone: "",
      avatar: "",
      roleId: "",
      status: true,
      realName: "",
      departmentIds: [],
    },
  });

  useEffect(() => {
    if (open) {
      if (userDetail) {
        form.reset({
          username: userDetail.username,
          password: "",
          nickname: userDetail.nickname || "",
          email: userDetail.email || "",
          phone: userDetail.phone || "",
          avatar: userDetail.avatar || "",
          roleId: userDetail.role?.id || "",
          status: userDetail.status === BooleanNumber.YES,
          power: userDetail.power,
          realName: userDetail.realName || "",
          departmentIds: userDetail.departments?.map((d) => d.id) || [],
        });
      } else {
        form.reset({
          username: "",
          password: "",
          nickname: "",
          email: "",
          phone: "",
          avatar: "",
          roleId: "",
          status: true,
          power: 0,
          realName: "",
          departmentIds: [],
        });
      }
    }
  }, [open, userDetail, form]);

  const createMutation = useCreateUserMutation({
    onSuccess: () => {
      toast.success("用户创建成功");
      onOpenChange(false);
      onSuccess?.();
    },
  });

  const updateMutation = useUpdateUserMutation({
    onSuccess: () => {
      toast.success("用户更新成功");
      onOpenChange(false);
      onSuccess?.();
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (values: FormValues) => {
    const { power: _power, ...submitValues } = values;

    if (isEditMode && userId && userDetail) {
      const dto: UpdateUserDto = {
        nickname: submitValues.nickname || undefined,
        email: submitValues.email || undefined,
        phone: submitValues.phone || undefined,
        avatar: submitValues.avatar || undefined,
        roleId: submitValues.roleId || undefined,
        status: submitValues.status ? BooleanNumber.YES : BooleanNumber.NO,
        realName: submitValues.realName || undefined,
      };
      if (submitValues.roleId === "no-role") {
        dto.roleId = "";
      }
      dto.departmentIds = submitValues.departmentIds || [];
      updateMutation.mutate({ id: userId, dto });
    } else {
      if (!submitValues.password) {
        form.setError("password", { message: "密码必须填写" });
        return;
      }
      const dto: CreateUserDto = {
        username: submitValues.username,
        password: submitValues.password,
        nickname: submitValues.nickname || undefined,
        email: submitValues.email || undefined,
        phone: submitValues.phone || undefined,
        avatar: submitValues.avatar || undefined,
        roleId: submitValues.roleId || undefined,
        status: submitValues.status ? BooleanNumber.YES : BooleanNumber.NO,
        realName: submitValues.realName || undefined,
      };
      if (submitValues.roleId === "no-role") {
        dto.roleId = "";
      }
      dto.departmentIds = submitValues.departmentIds || [];
      createMutation.mutate(dto);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="p-4">
          <DialogTitle>{isEditMode ? "编辑用户" : "创建用户"}</DialogTitle>
          <DialogDescription>
            {isEditMode ? "修改用户的基本信息" : "添加一个新的系统用户"}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[80vh]">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 p-4 pt-0 pb-17">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="avatar"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>头像</FormLabel>
                      <FormControl>
                        <ImageUpload
                          size="sm"
                          value={field.value}
                          onChange={(url) => field.onChange(url ?? "")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel required>启用状态</FormLabel>
                      <FormControl>
                        <RadioGroup
                          className="flex gap-4"
                          value={field.value ? "true" : "false"}
                          onValueChange={(v) => field.onChange(v === "true")}
                        >
                          <label className="flex items-center gap-2 text-sm">
                            <RadioGroupItem value="true" />
                            启用
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <RadioGroupItem value="false" />
                            禁用
                          </label>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>用户名</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="请输入用户名"
                        autoComplete="off"
                        {...field}
                        disabled={isEditMode}
                      />
                    </FormControl>
                    <FormDescription>用户登录时使用的账号名，创建后不可修改</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!isEditMode && (
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>密码</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="请输入密码"
                          autoComplete="new-password"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>用户登录时使用的密码，须包含数字和字母</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="nickname"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>昵称</FormLabel>
                    <FormControl>
                      <Input placeholder="请输入昵称（可选）" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="roleId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>角色</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="选择角色（可选）" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={"no-role"}>无角色</SelectItem>
                          {roles?.map((role: Role) => (
                            <SelectItem key={role.id} value={role.id}>
                              {role.name}
                              {role.description && (
                                <span className="text-muted-foreground ml-2 text-xs">
                                  ({role.description})
                                </span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="realName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>备注</FormLabel>
                      <FormControl>
                        <Input placeholder="请输入备注" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {isEditMode && (
                <FormField
                  control={form.control}
                  name="power"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>积分余额</FormLabel>
                      <FormControl>
                        <InputGroup className="w-full">
                          <InputGroupInput
                            value={field.value?.toString() ?? ""}
                            disabled={true}
                            readOnly
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupButton onClick={() => setBalanceDialogOpen(true)}>
                              <Pencil />
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>邮箱</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="请输入邮箱（可选）" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>手机号</FormLabel>
                      <FormControl>
                        <Input placeholder="请输入手机号（可选）" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="departmentIds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>所属部门</FormLabel>
                    {allDepartments && allDepartments.length > 0 ? (
                      <div className="grid max-h-40 grid-cols-2 gap-2 overflow-y-auto rounded-md border p-2">
                        {allDepartments.map((dept) => {
                          const checked = (field.value || []).includes(dept.id);
                          return (
                            <label
                              key={dept.id}
                              className="flex cursor-pointer items-center gap-2 text-sm"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => {
                                  const current = field.value || [];
                                  const next = v
                                    ? [...current, dept.id]
                                    : current.filter((id) => id !== dept.id);
                                  field.onChange(next);
                                }}
                              />
                              {dept.name}
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <FormDescription>暂无部门，请先在「部门管理」中创建</FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isEditMode && (
                <FormItem>
                  <FormLabel>订阅会员</FormLabel>
                  <div className="bg-muted flex items-center justify-between rounded-lg p-3">
                    {userDetail?.membershipLevel ? (
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <div>{userDetail.membershipLevel.name}</div>
                          {userDetail.membershipLevel.endTime && (
                            <div className="text-muted-foreground text-sm">
                              有效期至:{" "}
                              <TimeText
                                value={userDetail.membershipLevel.endTime}
                                format="YYYY/MM/DD"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <div>普通用户</div>
                          <div className="text-muted-foreground text-sm">有效期至: --</div>
                        </div>
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setMembershipDialogOpen(true)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </div>
                </FormItem>
              )}

              <DialogFooter className="bg-background absolute bottom-0 left-0 w-full flex-row justify-end rounded-lg p-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  取消
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending && <Loader2 className="animate-spin" />}
                  {isEditMode ? "保存" : "创建"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </ScrollArea>

        {userId && userDetail && (
          <BalanceAdjustmentDialog
            open={balanceDialogOpen}
            onOpenChange={setBalanceDialogOpen}
            user={userDetail}
            onSuccess={() => {
              setBalanceDialogOpen(false);
              refetchUserDetail();
              onSuccess?.();
            }}
          />
        )}

        {userId && userDetail && (
          <MembershipAdjustmentDialog
            open={membershipDialogOpen}
            onOpenChange={setMembershipDialogOpen}
            user={userDetail}
            onSuccess={() => {
              setMembershipDialogOpen(false);
              refetchUserDetail();
              onSuccess?.();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
