import { derivePassword } from '@/lib/bank-utils';
import { supabase } from '@/lib/supabase';
import type { AdminBank } from '@/components/sampler/types/sampler';

const ADMIN_BANK_SELECT = 'id, title, description, color, created_by, created_at, derived_key';

// Create admin bank, then derive key from the created DB id, update row, and return final row.
export async function createAdminBankWithDerivedKey(
  title: string,
  description: string,
  createdBy: string,
  color?: string,
): Promise<AdminBank | null> {
  try {
    let created: any = null;
    let insertErr: any = null;
    {
      const attempt = await supabase
        .from('banks')
        .insert({
          title,
          description,
          created_by: createdBy,
          ...(color ? { color } : {}),
        })
        .select(ADMIN_BANK_SELECT)
        .single();
      created = attempt.data;
      insertErr = attempt.error;
      if (insertErr && color && /column .*color/i.test(insertErr.message || '')) {
        const fallback = await supabase
          .from('banks')
          .insert({
            title,
            description,
            created_by: createdBy,
          })
          .select(ADMIN_BANK_SELECT)
          .single();
        created = fallback.data;
        insertErr = fallback.error;
      }
    }

    if (insertErr || !created) {
      return null;
    }

    const bankId: string = created.id;
    const derivedKey = await derivePassword(bankId);

    const { data: updated, error: updateErr } = await supabase
      .from('banks')
      .update({ derived_key: derivedKey })
      .eq('id', bankId)
      .select(ADMIN_BANK_SELECT)
      .single();

    if (updateErr || !updated) {
      return null;
    }

    return updated as AdminBank;
  } catch (error) {
    return null;
  }
}
