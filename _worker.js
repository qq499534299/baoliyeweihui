/**
 * Cloudflare Pages Advanced Mode Worker
 * 处理静态文件 + /api/submit 飞书表格写入
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

/** 诊断输出里不出现完整的 app_token / table_id */
function maskSecret(value) {
  if (!value) return 'MISSING';
  if (value.length <= 8) return '***';
  return value.substring(0, 4) + '***' + value.substring(value.length - 4);
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

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch (e) {
    throw new Error('飞书API返回非JSON (HTTP ' + resp.status + '): ' + text.substring(0, 200));
  }
  if (data.code !== 0) throw new Error('飞书token失败: code=' + data.code + ' msg=' + (data.msg || '未知'));

  cachedToken = data.tenant_access_token;
  tokenExpireAt = now + (data.expire - 300) * 1000;
  return cachedToken;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // API 路由
    if (pathname === '/api/submit') {
      return handleAPI(request, env);
    }

    // 诊断端点：必须配置 DEBUG_KEY 且密钥正确，否则当作不存在
    if (pathname === '/debug') {
      if (!isDebugAllowed(request, env)) {
        return new Response('Not Found', { status: 404 });
      }
      return handleAPI(request, env);
    }

    // 微信校验文件（防止 SPA fallback 返回 index.html）
    const wxVerifyFiles = {
      '/82421077846ac77623690f6482aa6872.txt': '6870a5ad1e6ca24b1febde005a1362517c20e482',
      '/5b0589a5d893950e0de6b06751198e99.txt': '362827a6432647be7b8cf310b1387c11133113ab'
    };
    if (wxVerifyFiles[pathname]) {
      return new Response(wxVerifyFiles[pathname], {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    // 其他请求走静态文件
    return env.ASSETS.fetch(request);
  }
};

async function handleAPI(request, env) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Debug
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/debug') {
    const debug = {};
    try {
      // Step 1: 检查环境变量
      debug.env = {
        FEISHU_APP_ID: env.FEISHU_APP_ID ? env.FEISHU_APP_ID.substring(0, 8) + '***' : 'MISSING',
        FEISHU_APP_SECRET: env.FEISHU_APP_SECRET ? '***已配置***' : 'MISSING',
        FEISHU_APP_TOKEN: maskSecret(env.FEISHU_APP_TOKEN),
        FEISHU_TABLE_ID: maskSecret(env.FEISHU_TABLE_ID)
      };

      if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET || !env.FEISHU_APP_TOKEN || !env.FEISHU_TABLE_ID) {
        return new Response(JSON.stringify(debug), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Step 2: 获取 token
      const tokenResp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET })
      });
      debug.token_step = { http_status: tokenResp.status };
      const tokenText = await tokenResp.text();
      try {
        const tokenData = JSON.parse(tokenText);
        debug.token_step.code = tokenData.code;
        debug.token_step.msg = tokenData.msg;
        if (tokenData.code === 0) {
          debug.token_step.success = true;
          debug.token_step.expire = tokenData.expire;

          // Step 3: 列出表格
          const listResp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables`, {
            headers: { Authorization: `Bearer ${tokenData.tenant_access_token}` }
          });
          debug.tables_step = { http_status: listResp.status };
          const listText = await listResp.text();
          try {
            const listData = JSON.parse(listText);
            debug.tables_step.code = listData.code;
            debug.tables_step.msg = listData.msg;
            if (listData.data && listData.data.items) {
              debug.tables_step.tables = listData.data.items.map(function(t) { return t.name + ' (id=' + t.table_id + ')'; });
            }
          } catch (e) {
            debug.tables_step.raw = listText.substring(0, 300);
          }

          // Step 4: 测试写入表格
          const testFields = {};
          testFields[FIELD_MAP.name] = 'DEBUG测试';
          testFields[FIELD_MAP.building] = '测试';
          testFields[FIELD_MAP.unit] = '测试';
          testFields[FIELD_MAP.room] = '测试';
          testFields[FIELD_MAP.address] = '测试';
          testFields[FIELD_MAP.phone] = '13800000000';
          testFields[FIELD_MAP.willingnessLabel] = '测试';
          testFields[FIELD_MAP.submittedAt] = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
          const writeResp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_ID}/records`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tokenData.tenant_access_token}`
            },
            body: JSON.stringify({ fields: testFields })
          });
          debug.write_step = { http_status: writeResp.status };
          const writeText = await writeResp.text();
          try {
            const writeData = JSON.parse(writeText);
            debug.write_step.code = writeData.code;
            debug.write_step.msg = writeData.msg;
          } catch (e) {
            debug.write_step.raw = writeText.substring(0, 300);
          }
        }
      } catch (e) {
        debug.token_step.raw = tokenText.substring(0, 300);
      }

      return new Response(JSON.stringify(debug, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
      });
    } catch (e) {
      debug.error = e.message;
      return new Response(JSON.stringify(debug), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // POST submit
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, message: '仅支持POST' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET || !env.FEISHU_APP_TOKEN || !env.FEISHU_TABLE_ID) {
      return new Response(JSON.stringify({ success: false, message: '服务配置不完整，缺少飞书环境变量' }), {
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
