(function () {
  'use strict';

  // --- 背景音乐控制 ---
  var bgm = document.getElementById('bgm');
  var musicBtn = document.getElementById('music-btn');
  var musicPlaying = false;

  if (bgm && musicBtn) {
    musicBtn.addEventListener('click', function () {
      if (musicPlaying) {
        bgm.pause();
        musicBtn.textContent = '🎵';
        musicBtn.classList.remove('playing');
        musicPlaying = false;
      } else {
        bgm.play().then(function () {
          musicBtn.textContent = '🎶';
          musicBtn.classList.add('playing');
          musicPlaying = true;
        }).catch(function () {
          musicBtn.textContent = '🔇';
          setTimeout(function () {
            musicBtn.textContent = '🎵';
          }, 1500);
        });
      }
    });
  }

  // --- 留资表单 ---
  var form = document.getElementById('signup-form');
  if (!form) return;

  var submitBtn = document.getElementById('submit-btn');
  var btnText = submitBtn.querySelector('.btn-text');
  var btnLoading = submitBtn.querySelector('.btn-loading');
  var formSuccess = document.getElementById('form-success');
  var formError = document.getElementById('form-error');
  var formErrorMsg = document.getElementById('form-error-msg');
  var formFields = form.querySelectorAll('.form-group, .submit-btn, .form-privacy');

  function isValidPhone(phone) {
    return /^1[3-9]\d{9}$/.test(phone);
  }

  function showError(msg) {
    formErrorMsg.textContent = msg || '提交失败，请稍后重试。如果一直失败，请在群里喊一声。';
    formError.style.display = 'block';
    setTimeout(function () {
      formError.style.display = 'none';
    }, 8000);
  }

  function setLoading(loading) {
    if (loading) {
      submitBtn.disabled = true;
      btnText.style.display = 'none';
      btnLoading.style.display = 'inline';
    } else {
      submitBtn.disabled = false;
      btnText.style.display = 'inline';
      btnLoading.style.display = 'none';
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    formSuccess.style.display = 'none';
    formError.style.display = 'none';

    var room = document.getElementById('room').value.trim();
    var phone = document.getElementById('phone').value.trim();
    var name = document.getElementById('name').value.trim();

    if (!room) { alert('请填写房号'); return; }
    if (!phone) { alert('请填写手机号'); return; }
    if (!isValidPhone(phone)) { alert('请输入正确的11位手机号码'); return; }

    // 表单只收联系方式，证件材料一律由邻居自己发给网格长
    var payload = {
      room: room,
      address: room,
      name: name,
      phone: phone,
      submittedAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    };

    setLoading(true);

    fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        setLoading(false);
        if (result.ok && result.data.success) {
          formFields.forEach(function (el) { el.style.display = 'none'; });
          formSuccess.style.display = 'block';
          formSuccess.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          showError(result.data.message);
        }
      })
      .catch(function () {
        setLoading(false);
        showError('网络连接失败，请稍后重试');
      });
  });
})();
