# 🔓 SQL Injection

## 🎯 **دسته‌بندی**
- OWASP Top 10: A03
- نوع: Injection
- خطر: بحرانی

## 📌 **نحوه کار**
- توضیح مختصر
- ![[SQLi-Flow.png]]  // می‌تونی نمودار بکشی

## ⚔️ **انواع روش‌ها**
### 1. Classic Union-Based
- پیلود: `' UNION SELECT null,version()--`
- کد مرتبط: [[PHP-Vulnerable-Code]]
- اکسپلویت: [[SQLi-Exploit-1]]

### 2. Blind Boolean-Based
- پیلود: `' AND 1=1--`
- تشخیص: [[Blind-Detection-Method]]
