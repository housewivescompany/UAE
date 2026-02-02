/**
 * UAE — Client-side JS
 */

// Auto-dismiss alerts after 5s
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.alert-dismissible').forEach(alert => {
    setTimeout(() => {
      const bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
      bsAlert.close();
    }, 5000);
  });
});

// Dashboard mode filter
function showAll() {
  setModeButtons(0);
}
function showBiz() {
  setModeButtons(1);
}
function showPol() {
  setModeButtons(2);
}

function setModeButtons(idx) {
  document.querySelectorAll('.mode-toggle .mode-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
  });
}
