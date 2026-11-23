-- 知意输入法 · Rime 常用段落
-- 由 tools/build-rime.mjs 生成，请勿手工修改。
local snippets = {
  { trigger = "dz", title = "收件地址", content = "北京市朝阳区望京街道阜通东大街 6 号院 3 号楼 1201 室\n收件人：林知意　138 0000 0000" },
  { trigger = "kp", title = "开票信息", content = "名称：北京知意科技有限公司\n纳税人识别号：91110105MA01ZHIYI8\n地址、电话：北京市朝阳区望京街 10 号院 010-8888 6666\n开户行及账号：招商银行北京望京支行 1109 0800 1234 567" },
  { trigger = "lk", title = "邮件落款", content = "此致\n敬礼\n\n林知意\n北京知意科技有限公司\n138 0000 0000" },
  { trigger = "hy", title = "会议邀请", content = "主题：产品体验评审\n时间：周四 14:00–15:30\n地点：三层「听雨」会议室 / 腾讯会议 123-456-789\n议程：1. 体验走查  2. 问题复盘  3. 下一步计划" },
  { trigger = "qj", title = "请假说明", content = "您好，因家中有事，我需请假一天（11 月 20 日），工作已交接给同事，紧急事务可电话联系。谢谢！" },
  { trigger = "jj", title = "个人简介", content = "林知意，产品设计师。关注中文输入体验与效率工具，喜欢把复杂的事做简单。" },
  { trigger = "xk", title = "收到回复", content = "收到，谢谢！我会尽快处理，有进展第一时间同步。" },
}

-- 触发码：输入 dz / kp 等，候选里会出现对应段落。
-- 说明：Rime 候选条的显示文本就是将要上屏的文本，
-- 因此较长的段落会在候选条中完整显示。
local function translator(input, seg, env)
  if #input < 2 then return end
  for _, item in ipairs(snippets) do
    local trigger = item.trigger
    if input == trigger or (#input >= 2 and trigger:sub(1, #input) == input) then
      yield(Candidate("zhiyi_snippet", seg.start, seg._end, item.content, item.title))
    end
  end
end

return translator
