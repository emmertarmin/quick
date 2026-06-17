# Gallery example

The Gallery example shows how a static app can accept user files, list them, display them, and delete them again through the Quick files API.

It lives in `examples/gallery/` and focuses on `quick.files`.

## Core principle: file handling

Uploads start with a normal browser `File` from an `<input type="file">`:

<div class="code-title">examples/gallery/index.html</div>

```js
const file = input.files?.[0];
if (!file) return;

await quick.files.upload(file);
```

The app lists files from Quick, filters to images, and sorts newest first:

<div class="code-title">examples/gallery/index.html</div>

```js
const files = await quick.files.all();
const images = files
  .filter((file) => file.content_type.startsWith("image/"))
  .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
```

Each returned file includes a stable URL that can be used directly in the page:

<div class="code-title">examples/gallery/index.html</div>

```js
const image = document.createElement("img");
image.src = file.url;
image.alt = file.name;
```

Deletion is similarly direct:

<div class="code-title">examples/gallery/index.html</div>

```js
await quick.files.delete(file.id);
```

## What to notice

The app does not implement multipart parsing, object storage, public URL generation, or file metadata tables. It only handles the user interaction. Quick owns the platform work and hands the page back file records with `id`, `name`, `content_type`, `size`, `url`, `created_at`, and `updated_at`.

Deploy it with:

```sh
quick deploy ./examples/gallery gallery
```
