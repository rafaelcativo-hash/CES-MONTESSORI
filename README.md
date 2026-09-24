# Registro CES Montessori

Sistema de gestión académica y administrativa para el **Centro Educativo Shkénuk / CES Montessori**, desarrollado como una aplicación web de página única (SPA), conectada a una base de datos en tiempo real con [Supabase](https://supabase.com).

🔗 **Sistema en producción:** https://rafaelcativo-hash.github.io/CES-MONTESSORI/

## Descripción

Esta plataforma centraliza la gestión escolar del centro educativo, permitiendo a administradores y docentes trabajar sobre una misma base de datos según su rol asignado. Incluye:

- **Matrícula y control de estudiantes**: alta, edición, promoción de fin de curso y ficha oficial imprimible/exportable.
- **Calificaciones**: planillas por componentes según cada asignatura, con reflexiones docentes.
- **Informes al Hogar**: generación, descarga en PDF/Word y envío por correo a los encargados.
- **Importación de notas desde Excel** con validación y previsualización antes de guardar.
- **Directorio de Docentes y Carga Académica**, con administración de roles de usuario (Administrador / Docente).
- **Contactos y Listas Oficiales** por nivel o ciclo educativo.
- **Control Financiero**: matrícula, materiales por semestre, mensualidades y generación de estados de cuenta.
- **Seguridad de la cuenta**: verificación en dos pasos (MFA) por aplicación autenticadora.

## Tecnologías

- HTML, CSS y JavaScript (sin frameworks de frontend)
- [Supabase](https://supabase.com) — base de datos, autenticación y seguridad a nivel de fila (RLS)
- [html2pdf.js](https://github.com/eKoopmans/html2pdf.js) — generación de documentos en PDF
- [SheetJS (xlsx)](https://sheetjs.com) — importación/exportación de datos en Excel
- [EmailJS](https://www.emailjs.com) — envío de correos desde el cliente
- Hospedado con [GitHub Pages](https://pages.github.com)

## Autoría

Desarrollado por **Rafael Cativo**.

© 2026 Rafael Cativo. Todos los derechos reservados.

Este proyecto y su código fuente son de uso exclusivo del Centro Educativo Shkénuk / CES Montessori. Queda prohibida su reproducción, distribución o modificación total o parcial sin autorización expresa del autor.
