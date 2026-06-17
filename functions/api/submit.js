/**
 * Cloudflare Pages Function
 * 接收前端表单数据，调用飞书 Open API 写入多维表格
 *
 * 环境变量（在 Cloudflare Pages 项目设置中配置）：
 *   FEISHU_APP_ID       - 飞书应用 App ID
 *   FEISHU_APP_SECRET   - 飞书应用 App Secret
 *   FEISHU_APP_TOKEN    - 多维表格的 app_token
 *   FEISHU_TABLE_ID     - 数据表的 table_id
 */

// 飞书字段名（必须与多维表格中的字段名完全一致）
const FIELD_MAP = {
  name: '姓名',
  building: '楼栋',
  unit: '单元',
  room: '门牌号',
  address: '完整房号',
  phone: '手机号',
  willingnessLabel: '参与意愿',
  submittedAt: '提交时间'
};

// 内存缓存 token
let cachedToken = null;
let tokenExpireAt = 0;

async function getAccessToken(env) {
  const now = Date.now();
  if (cachedToken && now < tokenExpireAt) {
    return cachedToken;
  }

  const resp = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: env.FEISHU_APP_ID,
        app_secret: env.FEISHU_APP_SECRET
      })
    }
  );

  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error('飞书token获取失败: ' + (data.msg || '未知错误'));
  }

  cachedToken = data.tenant_access_token;
  tokenExpireAt = now + (data.expire - 300) * 1000;
  return cachedToken;
}

async function addRecord(token, fields, env) {
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_ID}/records`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ fields })
  });

  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error('飞书表格写入失败: ' + (data.msg || '未知错误'));
  }
  return data;
}

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only POST
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, message: '仅支持POST' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const headers = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET || !env.FEISHU_APP_TOKEN || !env.FEISHU_TABLE_ID) {
      return new Response(JSON.stringify({ success: false, message: '服务配置不完整' }), {
        status: 500, headers
      });
    }

    const body = await request.json();

    if (!body.name || !body.unit || !body.room || !body.phone) {
      return new Response(JSON.stringify({ success: false, message: '请填写必填字段' }), {
        status: 400, headers
      });
    }

    const fields = {};
    fields[FIELD_MAP.name] = body.name;
    fields[FIELD_MAP.building] = body.building || '';
    fields[FIELD_MAP.unit] = body.unit;
    fields[FIELD_MAP.room] = body.room;
    fields[FIELD_MAP.address] = body.address;
    fields[FIELD_MAP.phone] = body.phone;
    fields[FIELD_MAP.willingnessLabel] = body.willingnessLabel || body.willingness;
    fields[FIELD_MAP.submittedAt] = body.submittedAt;

    const token = await getAccessToken(env);
    await addRecord(token, fields, env);

    return new Response(JSON.stringify({ success: true, message: '提交成功' }), {
      status: 200, headers
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, message: err.message }), {
      status: 500, headers
    });
  }
}
