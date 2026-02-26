import { forwardRef, type ComponentProps, type ChangeEvent } from 'react';
import { Form } from 'react-bootstrap';

type AppControlProps = Omit<ComponentProps<typeof Form.Control>, 'onChange'> & {
  onChange?: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
};

const AppControl = forwardRef<HTMLInputElement, AppControlProps>(function AppControl(props, ref) {
  return <Form.Control ref={ref} {...props} />;
});

export default AppControl;
