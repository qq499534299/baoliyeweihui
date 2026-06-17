/**
 * Vercel Serverless Function
 * 接收前端表单数据，调用飞书 Open API 写入多维表格
 *
 * 所需环境变量（在 Vercel 项目设置中配置）：
 *   FEISHU_APP_ID       - 飞书应用 App ID
 *   FEISHU_APP_SECRET   - 飞书应用 App Secret
 *   FEISHU_APP_TOKEN    - 多维表格的 app_token（从表格URL中获取）
 *   FEISHU_TABLE_ID     - 数据表的 table_id（从表格URL中获取）
 */

// 飞书字段名（必须与多维表格中的字段名完全一致）
var FIELD_MAP = {
  name: '姓名',
  building: '楼栋',
  unit: '单元',
  room: '门牌号',
  address: '完整房号',
  phone: '手机号',
  willingnessLabel: '参与意愿',
  submittedAt: '提交时间'
};

/**
 * 获取飞书 tenant_access_token（带内存缓存）
 */
var cachedToken = null;
var tokenExpireAt = 0;

async function getAccessToken() {
  var now = Date.now();
  if (cachedToken && now < tokenExpireAt) {
    return cachedToken;
  }

  var response = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: process.env.FEISHU_APP_ID,
        app_secret: process.env.FEISHU_APP_SECRET
      })
    }
  );

  var data = await response.json();

  if (data.code !== 0) {
    throw new Error('获取飞书token失败: ' + (data.msg || '未知错误'));
  }

  cachedToken = data.tenant_access_token;
  // 提前5分钟过期，避免边界情况
  tokenExpireAt = now + (data.expire - 300) * 1000;

  return cachedToken;
}

/**
 * 向多维表格新增一条记录
 */
async function addRecord(token, fields) {
  var appToken = process.env.FEISHU_APP_TOKEN;
  var tableId = process.env.FEISHU_TABLE_ID;

  var url =
    'https://open.feishu.cn/open-apis/bitable/v1/apps/' +
    appToken +
    '/tables/' +
    tableId +
    '/records';

  var response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token
    },
    body: JSON.stringify({ fields: fields })
  });

  var data = await response.json();

  if (data.code !== 0) {
    throw new Error('写入飞书表格失败: ' + (data.msg || '未知错误'));
  }

  return data;
}

/**
 * Vercel Serverless 入口
 */
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, message: '仅支持POST请求' });
    return;
  }

  try {
    // 检查环境变量
    if (
      !process.env.FEISHU_APP_ID ||
      !process.env.FEISHU_APP_SECRET ||
      !process.env.FEISHU_APP_TOKEN ||
      !process.env.FEISHU_TABLE_ID
    ) {
      console.error('缺少飞书环境变量配置');
      res.status(500).json({ success: false, message: '服务配置不完整' });
      return;
    }

    var body = req.body;

    // 简单校验
    if (!body.name || !body.building || !body.unit || !body.room || !body.phone) {
      res.status(400).json({ success: false, message: '请填写必填字段' });
      return;
    }

    // 构建飞书表格字段
    var fields = {};
    fields[FIELD_MAP.name] = body.name;
    fields[FIELD_MAP.building] = body.building;
    fields[FIELD_MAP.unit] = body.unit;
    fields[FIELD_MAP.room] = body.room;
    fields[FIELD_MAP.address] = body.address;
    fields[FIELD_MAP.phone] = body.phone;
    fields[FIELD_MAP.willingnessLabel] = body.willingnessLabel || body.willingness;
    fields[FIELD_MAP.submittedAt] = body.submittedAt;

    // 获取token并写入
    var token = await getAccessToken();
    await addRecord(token, fields);

    res.status(200).json({ success: true, message: '提交成功' });
  } catch (err) {
    console.error('提交失败:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
