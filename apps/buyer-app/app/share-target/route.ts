import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const formData = await request.formData();
  const title = formData.get('title');
  const text = formData.get('text');
  const url = formData.get('url');

  const params = new URLSearchParams();
  if (typeof title === 'string') params.set('title', title);
  if (typeof text === 'string') params.set('text', text);
  if (typeof url === 'string') params.set('url', url);

  return NextResponse.redirect(`/share?${params.toString()}`, {
    status: 303,
  });
}
