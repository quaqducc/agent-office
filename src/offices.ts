export interface RoomDef {
  id: string;
  name: string;
  roles: string[];
}

export interface OfficeTemplate {
  id: string;
  name: string;
  desc: string;
  roles: string[];
  rooms: RoomDef[];
}

export const OFFICE_TEMPLATES: OfficeTemplate[] = [
  {
    id: "startup-mvp",
    name: "Startup MVP",
    desc: "Khởi nghiệp tinh gọn, phát triển nhanh MVP và phản biện liên tục",
    roles: ["manager", "product-manager", "developer", "researcher", "critic"],
    rooms: [
      { id: "executive", name: "Ban Giám Đốc", roles: ["manager"] },
      { id: "product-research", name: "Sản Phẩm & Nghiên Cứu", roles: ["product-manager", "researcher", "critic"] },
      { id: "engineering", name: "Kỹ Thuật", roles: ["developer"] },
    ],
  },
  {
    id: "software-house",
    name: "Software House",
    desc: "Đội ngũ kỹ thuật hoàn chỉnh: kiến trúc, lập trình, kiểm thử và vận hành",
    roles: ["manager", "architect", "developer", "reviewer", "devops", "researcher"],
    rooms: [
      { id: "executive-arch", name: "Điều Hành & Kiến Trúc", roles: ["manager", "architect"] },
      { id: "dev-test", name: "Lập Trình & Kiểm Thử", roles: ["developer", "reviewer"] },
      { id: "ops-research", name: "Vận Hành & Nghiên Cứu", roles: ["devops", "researcher"] },
    ],
  },
  {
    id: "content-marketing",
    name: "Content & Marketing",
    desc: "Sáng tạo nội dung, nghiên cứu thị trường, chiến dịch và truyền thông",
    roles: ["manager", "marketing", "brainstormer", "researcher", "critic"],
    rooms: [
      { id: "executive", name: "Điều Hành", roles: ["manager"] },
      { id: "creative", name: "Sáng Tạo & Ý Tưởng", roles: ["brainstormer", "marketing"] },
      { id: "research-critique", name: "Nghiên Cứu & Phản Biện", roles: ["researcher", "critic"] },
    ],
  },
  {
    id: "research-lab",
    name: "Research Lab",
    desc: "Nghiên cứu chuyên sâu, lập kế hoạch chiến lược và phân tích đánh giá",
    roles: ["manager", "researcher", "critic", "planner", "brainstormer"],
    rooms: [
      { id: "exec-plan", name: "Điều Hành & Kế Hoạch", roles: ["manager", "planner"] },
      { id: "research-eval", name: "Nghiên Cứu & Đánh Giá", roles: ["researcher", "critic"] },
      { id: "creative-explore", name: "Ý Tưởng & Khám Phá", roles: ["brainstormer"] },
    ],
  },
];
