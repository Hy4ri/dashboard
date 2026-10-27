    const form = document.getElementById('login-form');
    const errorBanner = document.getElementById('error-banner');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBanner.style.display = 'none';
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const remember = document.getElementById('remember').checked;
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, remember })
        });
        const data = await res.json();
        if (data.success) {
          window.location.reload();
        } else {
          errorBanner.textContent = data.error || 'Invalid credentials';
          errorBanner.style.display = 'block';
        }
      } catch (err) {
        errorBanner.textContent = 'Server request failed: ' + err.message;
        errorBanner.style.display = 'block';
      }
    });
