# 施工项目 & 工人信息模块设计

日期：2026-06-21　状态：已确认

## 概述

新增两个管理模块，沿用分供方的 UI 模式（列表页 + 详情路由 + 表单弹窗），但信息结构按实体性质各自设计：

| 维度 | 分供方（参照） | 施工项目（新增） | 工人信息（新增） |
| --- | --- | --- | --- |
| 实体性质 | 企业 | 项目/工地 | 自然人 |
| 核心特征 | 税号·银行·证照 | 工期·状态·参建各方 | 身份证·工种·证书有效期 |
| 生命周期 | 无状态流转 | 筹备→施工→竣工→结算 | 在场 / 已退场 |
| 附件类型 | 营业执照·法人身份证·开户许可 | 无附件 | 身份证·安全证·特种作业证（带有效期） |

---

## 一、施工项目

### 1.1 数据模型

```
id:            "proj_<timestamp>_<seq>"
name:          ""        // 项目名称（必填，≥2字）——对应现有"工地/分区"名
code:          ""        // 项目编号（内部编号）
address:       ""        // 施工现场地址
type:          ""        // 项目类型：住宅 | 商业 | 市政 | 工业 | 装修 | 其他
area:          null      // 建筑面积（m²），数值
contractAmount: null     // 合同金额（万元），数值

startDate:     ""        // 开工日期  yyyy-mm-dd
plannedEnd:    ""        // 计划竣工日期
actualEnd:     ""        // 实际竣工日期
status:        "筹备中"  // 当前状态：筹备中 | 施工中 | 停工 | 已竣工 | 已结算

developer:     ""        // 建设单位（甲方/业主）
supervisor:    ""        // 监理单位
designer:      ""        // 设计单位
contractor:    ""        // 总包单位

manager:       ""        // 项目经理
managerPhone:  ""        // 项目经理电话
siteLeader:    ""        // 现场负责人
siteLeaderPhone: ""      // 现场负责人电话

note:          ""        // 备注
source:        "manual"  // 来源：manual | import
```

### 1.2 表单分组（弹窗）

| 分组 | 字段 | 布局 |
| --- | --- | --- |
| **基本信息** | 项目名称*（full）、项目编号、项目类型（select）、项目地址（full）、建筑面积、合同金额 | 2 列 |
| **工期进度** | 开工日期、计划竣工日期、实际竣工日期、当前状态（select） | 2 列 |
| **参建单位** | 建设单位、监理单位、设计单位、总包单位 | 2 列 |
| **管理人员** | 项目经理、项目经理电话、现场负责人、现场负责人电话 | 2 列 |
| （底部） | 备注（full） | — |

### 1.3 列表页

工具栏：标题"施工项目 · 共 N 个" + 搜索（项目名、地址）+ 新增按钮

表格列：

| 列 | 字段 | 宽度 | 备注 |
| --- | --- | --- | --- |
| # | seq | 52px | fixed left |
| 项目名称 | name | min 160px | fixed left，蓝色链接→详情页 |
| 状态 | status | 90px | 彩色 chip（筹备中=黄、施工中=蓝、停工=灰、已竣工=绿、已结算=绿） |
| 项目地址 | address | min 130px | |
| 开工日期 | startDate | 100px | |
| 建设单位 | developer | min 120px | |
| 项目经理 | manager | 80px | |
| 操作 | — | 130px | fixed right，详情/编辑/删除 |

### 1.4 详情页 `/project/:id`

分区展示：
- **项目信息卡片**：基本信息 + 工期 + 参建单位 + 管理人员（只读，右上"编辑"按钮开弹窗）
- **关联分供方**：该项目下送过货的分供方列表（从识别明细库按 site 匹配）
- **在场工人**：关联到该项目的工人花名册（从工人信息库按 currentProject 匹配）
- **费用概览**：材料送货总额、采购记录总额（聚合自分供方详情的数据）

### 1.5 与现有"工地/分区"的关系

现有系统中"工地"是送货单整理树和识别明细库的分区 key（纯字符串）。施工项目模块为其补充结构化元数据。匹配规则：**项目名称与识别明细库的 site 字段做 normalizeCompanyName 级别的模糊匹配**，让现有数据自动关联到项目实体。

---

## 二、工人信息

### 2.1 数据模型

```
id:            "wkr_<timestamp>_<seq>"
name:          ""        // 姓名（必填，≥2字）
gender:        ""        // 性别：男 | 女
idCard:        ""        // 身份证号（18位）
phone:         ""        // 联系电话（必填）
hometown:      ""        // 籍贯（省/市）
emergencyContact: ""     // 紧急联系人
emergencyPhone:   ""     // 紧急联系电话

trade:         ""        // 工种（必填）：木工 | 泥工 | 钢筋工 | 电工 | 焊工 | 架子工 |
                         //   油漆工 | 防水工 | 水暖工 | 测量工 | 普工 | 机械操作工 | 其他
skillLevel:    ""        // 技能等级：初级 | 中级 | 高级 | 技师
dailyWage:     null      // 日工资（元），数值
team:          ""        // 所属班组

currentProject: ""       // 当前项目名称（关联施工项目）
projectStatus:  "在场"   // 在场状态：在场 | 已退场
entryDate:     ""        // 进场日期
exitDate:      ""        // 退场日期

certs: [                 // 证书档案
  {
    id:        "cert_<ts>_<seq>",
    category:  "",       // 身份证 | 安全培训合格证 | 特种作业操作证 | 其他
    subType:   "",       // 子类型（特种作业：电工/焊工/高处作业/起重/…）
    fileName:  "",
    relPath:   "",       // 本地文件路径（Tauri 落盘）
    ext:       "",
    expiryDate: "",      // 有效期 yyyy-mm-dd（身份证无有效期可空）
    addedAt:   ""
  }
]

note:          ""        // 备注
source:        "manual"  // 来源：manual | import
```

### 2.2 表单分组（弹窗）

| 分组 | 字段 | 布局 |
| --- | --- | --- |
| **个人信息** | 姓名*、性别（select）、身份证号（full）、联系电话*、籍贯、紧急联系人、紧急联系电话 | 2 列 |
| **工作信息** | 工种*（select）、技能等级（select）、日工资、所属班组 | 2 列 |
| **项目分配** | 当前项目（select/combobox，关联施工项目列表）、在场状态（select）、进场日期、退场日期 | 2 列 |
| **证书档案** | 证书列表（身份证/安全证/特种作业证），每条显示：类别·文件名·有效期·上传/查看/删除 | 卡片式 |
| （底部） | 备注（full） | — |

### 2.3 列表页

工具栏：标题"工人信息库 · 共 N 人" + 搜索（姓名、工种、班组）+ 新增 + 导入/导出 Excel

**汇总卡片**（列表上方，3 列 metric cards）：
- 在场工人数（蓝色）
- 已退场人数（灰色）
- 证书即将过期数（橙色，30 天内到期）

表格列：

| 列 | 字段 | 宽度 | 备注 |
| --- | --- | --- | --- |
| # | seq | 52px | fixed left |
| 姓名 | name | 80px | fixed left，蓝色链接→详情页 |
| 工种 | trade | 80px | |
| 所属班组 | team | 90px | |
| 当前项目 | currentProject | min 120px | |
| 在场状态 | projectStatus | 80px | chip（在场=蓝、已退场=灰） |
| 日工资 | dailyWage | 80px | ¥ 前缀 |
| 联系电话 | phone | 110px | |
| 操作 | — | 130px | fixed right，详情/编辑/删除 |

### 2.4 详情页 `/worker/:id`

分区展示：
- **个人信息卡片**：基本信息 + 工作信息 + 当前项目分配（只读，右上"编辑"）
- **证书档案**：证书列表 + 有效期状态（已过期=红、30天内到期=橙、有效=绿）
- **出勤记录**：手动记录的出勤天数（按月统计表格）
  - `{ id, month, daysWorked, note }`
- **工资支付记录**：类似分供方的支付记录
  - `{ id, date, amount, method, note }`
- **对账余额**：应付 = 出勤天数 × 日工资 − 已支付

### 2.5 证书有效期追踪

工人的证书有 `expiryDate` 字段，系统需主动提示：
- 列表页汇总卡片显示"证书即将过期"数（30 天内）
- 证书列表中状态着色：已过期=红底、30 天内到期=橙底、有效=绿底、无有效期=灰
- 后续可考虑侧边栏 badge 提示

---

## 三、路由与导航

### 3.1 新增路由

```
/project          → ProjectView（施工项目列表）
/project/:id      → ProjectDetailView（施工项目详情）
/worker           → WorkerView（工人信息列表）
/worker/:id       → WorkerDetailView（工人信息详情）
```

### 3.2 侧边栏导航扩展

在现有 4 个导航项后新增 2 个：

```js
{ path: "/project", label: "施工项目", mark: "项", match: "/project",
  title: "施工项目", subtitle: "项目管理", icon: "i-lucide-building" },
{ path: "/worker",  label: "工人信息", mark: "工", match: "/worker",
  title: "工人信息库", subtitle: "人员管理", icon: "i-lucide-users" },
```

---

## 四、Pinia Store

### 4.1 useProjectStore

```
localStorage key: "projectDb.v1"
list: ref([])
persist() / byId(id) / findDuplicate(name, exceptId) / add(record) / update(record) / remove(id)
```

### 4.2 useWorkerStore

```
localStorage key: "workerDb.v1"
list: ref([])
persist() / byId(id) / add(record) / update(record) / remove(id)
// 额外方法：
byProject(projectName)     // 按项目筛选工人
expiringCerts(days=30)     // 返回 N 天内证书到期的工人列表
```

---

## 五、Excel 导入/导出

### 5.1 施工项目

导出单 sheet "施工项目"，表头：项目名称、项目编号、项目类型、项目地址、建筑面积、合同金额、开工日期、计划竣工、实际竣工、状态、建设单位、监理单位、设计单位、总包单位、项目经理、项目经理电话、现场负责人、现场负责人电话、备注。

导入：灵活表头匹配（同分供方逻辑），按项目名称去重。

### 5.2 工人信息

导出单 sheet "工人信息"，表头：姓名、性别、身份证号、联系电话、籍贯、紧急联系人、紧急联系电话、工种、技能等级、日工资、所属班组、当前项目、在场状态、进场日期、退场日期、备注。

导入同理，按姓名+身份证号去重。

---

## 六、实现优先级

1. **施工项目**：store + 列表页 + 表单弹窗 + 路由/导航 → 详情页
2. **工人信息**：store + 列表页 + 表单弹窗 + 路由/导航 → 详情页
3. 跨模块关联：项目详情关联分供方/工人、工人详情关联项目
4. Excel 导入/导出
5. 证书有效期预警
