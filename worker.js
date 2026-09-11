/**
 * Cloudflare Worker - 业委会表单提交 API
 * 接收前端表单数据，写入飞书多维表格
 *
 * 环境变量（在 Worker Settings → Variables 中配置）：
 *   FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_APP_TOKEN, FEISHU_TABLE_ID
 */

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

let cachedToken = null;
let tokenExpireAt = 0;

/**
 * /debug 只对带密钥的请求开放。
 * 没有配置 DEBUG_KEY 时一律关闭（返回 404），避免线上裸奔。
 */
function isDebugAllowed(request, env) {
  if (!env.DEBUG_KEY) return false;
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || request.headers.get('X-Debug-Key') || '';
  return key !== '' && key === env.DEBUG_KEY;
}

/** 空值不写进飞书：单选、日期这类字段收到空字符串会导致整条写入失败 */
function setField(fields, key, value) {
  if (value === undefined || value === null) return;
  const v = typeof value === 'string' ? value.trim() : value;
  if (v === '') return;
  fields[key] = v;
}

async function getAccessToken(env) {
  const now = Date.now();
  if (cachedToken && now < tokenExpireAt) return cachedToken;

  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET })
  });

  const data = await resp.json();
  if (data.code !== 0) throw new Error('飞书token失败: ' + (data.msg || '未知错误'));

  cachedToken = data.tenant_access_token;
  tokenExpireAt = now + (data.expire - 300) * 1000;
  return cachedToken;
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    // Debug endpoint（必须配置 DEBUG_KEY 且密钥正确，否则当作不存在）
    const url = new URL(request.url);
    if (url.pathname === '/debug' && !isDebugAllowed(request, env)) {
      return new Response('Not Found', { status: 404 });
    }
    if (request.method === 'GET' && url.pathname === '/debug') {
      try {
        const token = await getAccessToken(env);
        const resp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_ID}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await resp.json();
        return new Response(JSON.stringify({ token_ok: true, table: data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ success: false, message: '仅支持POST' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET || !env.FEISHU_APP_TOKEN || !env.FEISHU_TABLE_ID) {
        return new Response(JSON.stringify({ success: false, message: '服务配置不完整' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const body = await request.json();

      if (!body.room || !body.phone) {
        return new Response(JSON.stringify({ success: false, message: '请填写房号和手机号' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const fields = {};
      setField(fields, FIELD_MAP.name, body.name);
      setField(fields, FIELD_MAP.building, body.building);
      setField(fields, FIELD_MAP.unit, body.unit);
      setField(fields, FIELD_MAP.room, body.room);
      setField(fields, FIELD_MAP.address, body.address || body.room);
      setField(fields, FIELD_MAP.phone, body.phone);
      setField(fields, FIELD_MAP.willingnessLabel, body.willingnessLabel || body.willingness);
      setField(fields, FIELD_MAP.submittedAt, body.submittedAt || new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));

      const token = await getAccessToken(env);
      await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_ID}/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ fields })
      });

      return new Response(JSON.stringify({ success: true, message: '提交成功' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, message: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
